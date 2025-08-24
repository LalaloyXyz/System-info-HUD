import { BaseModule } from './baseModule.js';

export class CPUModule extends BaseModule {
    constructor() {
        super(1000); // 1 second cache TTL
        this._networkInterface = { lastIface: null, lastRx: 0, lastTx: 0, lastTimestamp: 0 };
    }

    async getCPUInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        try {
            // Get CPU info using lscpu
            const lscpuText = await this._executeCommand(['lscpu']);
            
            let modelName = "Unknown CPU";
            const modelNamePatterns = [
                /Model name:\s+(.+)/,   // Intel, AMD, some ARM
                /Model:\s+(.+)/,        // Some AMD/older CPUs
                /CPU:\s+(.+)/,          // Fallback
                /Hardware:\s+(.+)/,     // ARM
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

            // Get CPU frequencies and core mapping
            let freqText = '';
            try {
                freqText = await this._readFile('/proc/cpuinfo');
            } catch (e) {
                console.error('Error reading /proc/cpuinfo:', e);
            }
            
            const coreSpeeds = [];
            const processorToCoreMap = {};
            const lines = freqText.split('\n');
            let currentProcessorId = null;
            let isAMD = modelName.toLowerCase().includes('amd');

            // Get current CPU frequencies
            try {
                const freqOut = await this._executeCommand(['sh', '-c', `
                    for i in /sys/devices/system/cpu/cpu*/cpufreq/; do
                        if [ -f "$i/scaling_cur_freq" ]; then
                            cat "$i/scaling_cur_freq";
                        elif [ -f "$i/cpuinfo_cur_freq" ]; then
                            cat "$i/cpuinfo_cur_freq";
                        fi;
                    done | sort -V
                `]);

                const frequencies = freqOut.trim().split('\n');
                frequencies.forEach((freq, index) => {
                    if (freq) {
                        coreSpeeds[index] = Math.floor(parseInt(freq) / 1000); // Convert kHz to MHz
                    }
                });
            } catch (e) {
                console.error('Error reading CPU frequencies:', e);
            }

            for (let i = 0; i < coreCount; i++) {
                if (!coreSpeeds[i]) {
                    coreSpeeds[i] = 0;
                }
            }

            // Unified core mapping logic for both AMD and Intel
            for (const line of lines) {
                if (line.startsWith('processor')) {
                    currentProcessorId = line.split(':')[1].trim();
                } else if (line.startsWith('core id') && currentProcessorId !== null) {
                    const coreId = line.split(':')[1].trim();
                    processorToCoreMap[currentProcessorId] = coreId;
                }
            }

            const threadsPerCoreMatch = lscpuText.match(/Thread\(s\) per core:\s+(\d+)/);
            const threadsPerCore = threadsPerCoreMatch ? parseInt(threadsPerCoreMatch[1]) : 2;

            if (isAMD && Object.keys(processorToCoreMap).length === 0) {
                for (let i = 0; i < coreCount; i++) {
                    processorToCoreMap[i] = Math.floor(i / threadsPerCore).toString();
                }
            }

            // Get temperature data
            const sensorText = await this._executeCommand(['sensors']);
            const coreTemps = {};
            
            // Universal temperature patterns that work for both Intel and AMD
            const tempPatterns = [
                /^Core\s+(\d+):\s+\+([\d.]+)°C/mg,           // Standard core temp
                /^Core\s+\d+\s+\(PECI\s+\d+\):\s+\+([\d.]+)°C/mg,  // PECI core temps
                /^CPU\s+Core\s+(\d+):\s+\+([\d.]+)°C/mg,     // Alternative core temp format
                /^Package\s+id\s+\d+:\s+\+([\d.]+)°C/mg,     // Package temp
                /^Package\s+\d+:\s+\+([\d.]+)°C/mg,          // Alternative package temp
                /^CPU\s+Temperature:\s+\+([\d.]+)°C/mg,      // Generic CPU temp
                // AMD specific patterns
                /^Tctl:\s+\+([\d.]+)°C/mg,                   // AMD Tctl
                /^Tdie:\s+\+([\d.]+)°C/mg,                   // AMD Tdie
                /^CPU\s+Tctl\/Tdie:\s+\+([\d.]+)°C/mg,       // Alternative AMD temp
                // Intel specific patterns
                /^Package\s+id\s+0:\s+\+([\d.]+)°C/mg,       // Intel package temp
                /^Core\s+\d+\s+\(PECI\s+\d+\):\s+\+([\d.]+)°C/mg,  // Intel PECI
                /^CPU\s+Package:\s+\+([\d.]+)°C/mg           // Intel package temp
            ];
            
            let globalTemp = null;
            let foundAnyTemp = false;
            
            for (const pattern of tempPatterns) {
                let match;
                pattern.lastIndex = 0;
                
                while ((match = pattern.exec(sensorText)) !== null) {
                    const coreId = match[1] || '0';
                    const temp = parseFloat(match[2] || match[1]);
                    
                    if (match[1]) {
                        coreTemps[coreId] = temp.toFixed(0);
                        foundAnyTemp = true;
                    } else {
                        globalTemp = temp;
                    }
                }
            }
            
            if (!foundAnyTemp && globalTemp) {
                for (let i = 0; i < coreCount; i++) {
                    coreTemps[i.toString()] = globalTemp.toFixed(0);
                }                
            }

            if (Object.keys(coreTemps).length === 0) {
                const anyTempMatch = sensorText.match(/\+([\d.]+)°C/);
                if (anyTempMatch) {
                    const temp = parseFloat(anyTempMatch[1]);
                    for (let i = 0; i < Math.ceil(coreCount / 2); i++) {
                        coreTemps[i.toString()] = temp.toFixed(0);
                    }
                }
            }
    
            const result = [];
            for (let i = 0; i < coreCount; i++) {
                const coreName = `Core-${String(i).padStart(2, '0')}    |`;
                const speed = coreSpeeds[i] || 0;
                const coreload = String(Math.round((coreSpeeds[i] / cpumax) * 100)).padStart(2, '0');
                const physicalCoreId = processorToCoreMap[i] || "0";
                const temp = coreTemps[physicalCoreId] || "N/A";
                
                const speedEmoji = this._getStatusEmoji(coreload, [90, 70, 50, 30]);

                const tempNum = parseFloat(temp);
                const tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                
                const speedStr = `${speed} MHz`.padEnd(10);
                const tempStr = `|  ${coreload}%  |   ${tempEmoji} Temp   ${temp} °C`;
                
                if (speed < 1000) 
                    result.push(`${speedEmoji} ${coreName}       ${speedStr}   ${tempStr}`);
                else 
                    result.push(`${speedEmoji} ${coreName}     ${speedStr}    ${tempStr}`);
            }
    
            const finalResult = {
                cpu: modelName,
                core: coreCount,
                coreSpeeds: result
            };
    
            this._updateCache(finalResult);
            return finalResult;
        } catch (e) {
            console.error('Error reading CPU info:', e);
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