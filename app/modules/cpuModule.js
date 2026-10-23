import { BaseModule } from './baseModule.js';
import GLib from 'gi://GLib';

export class CPUModule extends BaseModule {
    constructor() {
        super(1000); // 1 second cache TTL
        this._networkInterface = { lastIface: null, lastRx: 0, lastTx: 0, lastTimestamp: 0 };
        this._execCache = {};
        this._cpuStatSnapshot = null;
    }

    async _hasExecutable(bin) {
        if (this._execCache[bin] !== undefined) return this._execCache[bin];
        this._execCache[bin] = GLib.find_program_in_path(bin) !== null;
        return this._execCache[bin];
    }

    async _getIntegratedGpuTemperature() {
        const temperatures = [];
        for (const hwmon of await this._listDirs('/sys/class/hwmon', /^hwmon\d+$/)) {
            const path = `/sys/class/hwmon/${hwmon}`;
            const name = (await this._readFile(`${path}/name`, true)).trim();
            // amdgpu exposes northbridge voltage only on APUs, not discrete GPUs.
            if (name !== 'amdgpu' || (await this._readFile(`${path}/in1_label`, true)).trim() !== 'vddnb')
                continue;
            const reading = (await this._readFile(`${path}/temp1_input`, true)).trim();
            if (!/^-?\d+$/.test(reading))
                continue;
            const temperature = Number(reading) / 1000;
            if (Number.isFinite(temperature))
                temperatures.push(temperature.toFixed(0));
        }
        return temperatures.length === 1 ? temperatures[0] : null;
    }

    async _getCoreLoads() {
        const statText = await this._readFile('/proc/stat');
        const nextSnapshot = new Map();

        for (const line of statText.split('\n')) {
            const match = line.match(/^cpu(\d+)\s+(.*)$/);
            if (!match)
                continue;

            const values = match[2].trim().split(/\s+/).map(Number);
            if (values.length < 5 || values.some(value => !Number.isFinite(value)))
                continue;

            // Use the first eight fields. Guest time is already included in user time.
            const idle = values[3] + values[4];
            const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
            nextSnapshot.set(Number(match[1]), { idle, total });
        }

        const loads = [];
        for (const [index, current] of nextSnapshot) {
            const previous = this._cpuStatSnapshot?.get(index);
            if (!previous) {
                loads[index] = 0;
                continue;
            }

            const totalDelta = current.total - previous.total;
            const idleDelta = current.idle - previous.idle;
            loads[index] = totalDelta > 0
                ? Math.round(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)))
                : 0;
        }

        this._cpuStatSnapshot = nextSnapshot;
        return loads;
    }
    
    async getCPUInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        try {
            const coreLoads = await this._getCoreLoads();

            // Get CPU info using lscpu if available, else fallback to /proc/cpuinfo
            let lscpuText = '';
            const hasLscpu = await this._hasExecutable('lscpu');
            if (hasLscpu) {
                try {
                    lscpuText = await this._executeCommand(['lscpu']);
                } catch (e) {
                    lscpuText = '';
                }
            }
            if (!lscpuText.trim()) {
                try {
                    lscpuText = await this._readFile('/proc/cpuinfo');
                } catch (e) {
                    lscpuText = '';
                }
            }
            
            let modelName = "Unknown CPU";
            const modelNamePatterns = [
                /^(?:Model name|model name)\s*:\s+(.+)/m,   // Intel, AMD, some ARM
                /^Model\s*:\s+(.+)/m,        // Some AMD/older CPUs
                /^(?:CPU|Processor)\s*:\s+(.+)/m,          // Fallback
                /^Hardware\s*:\s+(.+)/m,     // ARM
            ];
            
            for (const pattern of modelNamePatterns) {
                const match = lscpuText.match(pattern);
                if (match) {
                    modelName = match[1].trim();
                    break;
                }
            }

            // Core count: try lscpu, then fallback to /proc/cpuinfo
            let coreCount = 0;
            const coresMatch = lscpuText.match(/CPU\(s\):\s+(\d+)/);
            if (coresMatch) {
                coreCount = parseInt(coresMatch[1]);
            } else {
                // Fallback: count "processor" lines in /proc/cpuinfo
                const cpuinfoCores = lscpuText.match(/^processor\s*:/mg);
                if (cpuinfoCores) {
                    coreCount = cpuinfoCores.length;
                }
            }

            const processorIds = Object.keys(coreLoads).map(Number);
            if (processorIds.length)
                coreCount = processorIds.length;

            // Max frequency: try lscpu, then fallback to /proc/cpuinfo
            let cpumax = 0;
            const cpumaxMatch = lscpuText.match(/CPU max MHz:\s+([\d.]+)/);
            if (cpumaxMatch) {
                cpumax = parseFloat(cpumaxMatch[1]);
            } else {
                // Try /sys for ARM
                try {
                    const freq = await this._readFile('/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq');
                    const freqNum = parseInt(freq.trim());
                    if (!isNaN(freqNum)) {
                        cpumax = freqNum / 1000; // kHz to MHz
                    }
                } catch (e) {
                    // Ignore error
                }
            }

            let freqText = '';
            try {
                freqText = await this._readFile('/proc/cpuinfo');
            } catch (e) {
                logError(e, 'System HUD: Error reading /proc/cpuinfo');
            }
            
            const coreSpeeds = [];
            const processorToCoreMap = {};
            // Keep CPU IDs with readings: sorting frequencies loses core identity.
            for (const block of freqText.split(/\n\s*\n/)) {
                const id = block.match(/^processor\s*:\s*(\d+)/m)?.[1];
                if (id === undefined)
                    continue;
                const core = block.match(/^core id\s*:\s*(\d+)/m)?.[1] ?? id;
                const socket = block.match(/^physical id\s*:\s*(\d+)/m)?.[1] ?? '0';
                processorToCoreMap[id] = { core, socket };
                const mhz = block.match(/^cpu MHz\s*:\s*([\d.]+)/m)?.[1];
                coreSpeeds[id] = mhz ? Math.floor(Number(mhz)) : 0;
            }
            const cpuIds = processorIds.length ? processorIds : Array.from({ length: coreCount }, (_, i) => i);
            await Promise.all(cpuIds.map(async id => {
                const path = `/sys/devices/system/cpu/cpu${id}/cpufreq/`;
                const text = (await this._readFile(`${path}scaling_cur_freq`, true)).trim()
                    || (await this._readFile(`${path}cpuinfo_cur_freq`, true)).trim();
                const frequency = Number.parseInt(text, 10);
                if (Number.isFinite(frequency))
                    coreSpeeds[id] = Math.floor(frequency / 1000);
            }));

            let sensorText = '';
            const hasSensors = await this._hasExecutable('sensors');
            if (hasSensors) {
                try {
                    sensorText = await this._executeCommand(['sensors']);
                } catch (e) {
                    sensorText = '';
                }
            }

            const coreTemps = {};
            const packageTemps = {};
            // Restrict readings to CPU sensors; a GPU/SSD temperature is not a CPU fallback.
            for (const section of sensorText.split(/\n\s*\n/)) {
                if (!/^(?:coretemp|k10temp|zenpower|cpu_thermal|cpu-)/i.test(section.trim()))
                    continue;
                const packageId = section.match(/Package\s+id\s+(\d+):/i)?.[1];
                const isaId = section.match(/^coretemp-isa-([\da-f]+)/i)?.[1];
                const socket = packageId ?? (isaId ? String(parseInt(isaId, 16)) : '0');
                if (!packageId && !isaId && new Set(Object.values(processorToCoreMap).map(cpu => cpu.socket)).size > 1)
                    continue;
                for (const match of section.matchAll(/^\s*(?:CPU\s+)?Core\s+(\d+)(?:\s+\(PECI\s+\d+\))?:\s*\+?(-?[\d.]+)\s*°?\s*C/gmi))
                    coreTemps[`${socket}:${match[1]}`] = Number(match[2]).toFixed(0);
                const packageMatch = section.match(/^\s*(?:Package\s+(?:id\s+)?\d+|Tdie|Tctl|CPU(?:\s+Temperature|\s+Package|\s+Tctl\/Tdie)?|temp1):\s*\+?(-?[\d.]+)\s*°?\s*C/mi);
                if (packageMatch) {
                    const temp = Number(packageMatch[1]);
                    packageTemps[socket] = temp.toFixed(0);
                }
            }

            const sockets = new Set(Object.values(processorToCoreMap).map(cpu => cpu.socket));
            const igpuTemp = !Object.keys(coreTemps).length && !Object.keys(packageTemps).length && sockets.size <= 1
                ? await this._getIntegratedGpuTemperature() : null;
            const result = [];
            const coreDetails = [];
            for (const i of cpuIds) {
                const coreName = `Core-${String(i).padStart(2, '0')}    |`;
                const speed = coreSpeeds[i] || 0;
                const loadPercent = coreLoads[i] ?? 0;
                const coreload = String(loadPercent).padStart(2, '0');
                const { core, socket } = processorToCoreMap[i] ?? { core: String(i), socket: '0' };
                const temp = coreTemps[`${socket}:${core}`] ?? packageTemps[socket] ?? igpuTemp ?? 'N/A';
                
                const speedMarker = this._getStatusMarker(loadPercent, [90, 70, 50, 30]);

                const tempNum = parseFloat(temp);
                const tempMarker = this._getStatusMarker(tempNum, [80, 70, 55, 40, 30, 0]);
                
                const speedStr = `${speed} MHz`.padEnd(10);
                const tempStr = `|  ${coreload}%  |   ${tempMarker} Temp   ${temp} °C`;
                
                if (speed < 1000) 
                    result.push(`${speedMarker} ${coreName}       ${speedStr}   ${tempStr}`);
                else 
                    result.push(`${speedMarker} ${coreName}     ${speedStr}    ${tempStr}`);

                coreDetails.push({
                    index: i,
                    name: `Core-${String(i).padStart(2, '0')}`,
                    speed,
                    load: loadPercent,
                    temp
                });
            }
    
            const finalResult = {
                cpu: modelName,
                core: coreCount,
                coreSpeeds: result,
                coreDetails,
                temperatureSource: igpuTemp !== null ? 'igpu' : 'cpu'
            };
    
            this._updateCache(finalResult);
            return finalResult;
        } catch (e) {
            logError(e, 'System HUD: Error reading CPU info');
            return {
                cpu: 'Unknown CPU',
                core: 0,
                coreSpeeds: ['Error reading CPU information']
            };
        }
    }

    getInfo() {
        return this.getCPUInfo();
    }
}
