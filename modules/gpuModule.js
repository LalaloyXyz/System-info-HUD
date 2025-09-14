import { BaseModule } from './baseModule.js';

export class GPUModule extends BaseModule {
    constructor() {
        super(2000); // 2 second cache TTL
    }

    async getGPUInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }
        return new Promise((resolve) => {
            this._getGpuInfoAsync((result) => {
                this._updateCache(result);
                resolve(result);
            });
        });
    }

    async _getNvidiaInfo() {
        const gpus = [];
        try {
            const nvidiaPath = await this._executeCommand(['which', 'nvidia-smi']);
            if (!nvidiaPath.trim()) return gpus;
            const nvidiaData = await this._executeCommand([
                'nvidia-smi',
                '--query-gpu=name,memory.total,memory.used,temperature.gpu',
                '--format=csv,noheader,nounits'
            ]);
            // Get clockspeed (current and max)
            const nvidiaClockData = await this._executeCommand([
                'nvidia-smi',
                '--query-gpu=clocks.current.graphics,clocks.max.graphics',
                '--format=csv,noheader,nounits'
            ]);
            let clocks = [];
            if (nvidiaClockData) {
                clocks = nvidiaClockData.trim().split('\n').map(line => line.split(',').map(s => s.trim()));
            }
            if (!nvidiaData) return gpus;
            const gpuLines = nvidiaData.trim().split('\n');
            for (let i = 0; i < gpuLines.length; i++) {
                const line = gpuLines[i];
                const [name, total, used, temp] = line.split(',').map(s => s.trim());
                let clockspeed, clockspeedMax;
                if (clocks[i]) {
                    clockspeed = clocks[i][0];
                    clockspeedMax = clocks[i][1];
                }
                gpus.push({
                    name,
                    vramTotal: total,
                    vramUsed: used,
                    temp,
                    clockspeed,
                    clockspeedMax
                });
            }
        } catch (e) {
            // Ignore
        }
        return gpus;
    }

    async _getAmdInfo() {
        const gpus = [];
        try {
            const amdPath = await this._executeCommand(['which', 'rocm-smi']);
            if (amdPath.trim()) {
                const amdData = await this._executeCommand([
                    'rocm-smi',
                    '--showproductname',
                    '--showmemuse',
                    '--json'
                ]);
                if (amdData) {
                    const amdInfo = JSON.parse(amdData.trim());
                    for (const key in amdInfo) {
                        const gpu = amdInfo[key];
                        if (gpu["Card series"]) {
                            gpus.push({
                                name: gpu["Card series"],
                                vramTotal: Math.round(parseInt(gpu["VRAM Total Memory (B)"]) / (1024 * 1024)),
                                vramUsed: Math.round(parseInt(gpu["VRAM Used Memory (B)"]) / (1024 * 1024)),
                                temp: gpu["Temperature (C)"]
                            });
                        }
                    }
                }
            }
            // Supplement with sensors
            const sensorGPUs = await this._parseSensorsForGPU('amd');
            for (const gpu of sensorGPUs) {
                // Avoid duplicates by name
                if (!gpus.some(g => g.name === gpu.name)) {
                    gpus.push({
                        name: gpu.name,
                        temp: gpu.temp,
                        clockspeed: gpu.sclk
                    });
                }
            }
        } catch (e) {
            // Ignore
        }
        return gpus;
    }

    async _getIntelInfo() {
        const gpus = [];
        try {
            const lspciOutput = await this._executeCommand(['lspci']);
            const arcMatch = lspciOutput.match(/VGA.*Intel.*(Arc|DG2).*\[(.*?)\]/i);
            const intelMatch = lspciOutput.match(/VGA.*Intel.*\[(.*?)\]/i);
            // Try intel_gpu_top first
            const igttStats = await this._getIntelGpuTopStats();
            if (igttStats) {
                let name = arcMatch ? `Intel Arc GPU: ${arcMatch[2] || 'DG2'}` : (intelMatch ? intelMatch[1] : 'Intel GPU');
                gpus.push({
                    name,
                    temp: igttStats.temp,
                    clockspeed: igttStats.freq,
                    clockspeedMax: igttStats.freqMax,
                    power: igttStats.power,
                    utilization: igttStats.utilization
                });
            } else {
                if (arcMatch) {
                    gpus.push({ name: `Intel Arc GPU: ${arcMatch[2] || 'DG2'}` });
                } else if (intelMatch) {
                    gpus.push({ name: intelMatch[1] });
                }
                // Supplement with sensors
                const sensorGPUs = await this._parseSensorsForGPU('intel');
                for (const gpu of sensorGPUs) {
                    if (!gpus.some(g => g.name === gpu.name)) {
                        gpus.push({
                            name: gpu.name,
                            temp: gpu.temp,
                            clockspeed: gpu.clk
                        });
                    }
                }
            }
        } catch (e) {
            // Ignore
        }
        return gpus;
    }

    async _parseSensorsForGPU(vendor) {
        const sensorsText = await this._executeCommand(['sensors']);
        const results = [];
        if (vendor === 'amd') {
            const amdSections = sensorsText.split(/\n(?=amdgpu-pci-)/);
            for (const section of amdSections) {
                if (!section.includes('amdgpu-pci-')) continue;
                const nameMatch = section.match(/amdgpu-pci-([\w:-]+)/);
                const name = nameMatch ? `AMD GPU (${nameMatch[1]})` : 'AMD GPU';
                const tempMatch = section.match(/edge:\s+\+([\d.]+)°C/);
                const temp = tempMatch ? tempMatch[1] : undefined;
                const sclkMatch = section.match(/sclk:\s+([\d.]+) MHz/);
                const sclk = sclkMatch ? sclkMatch[1] : undefined;
                results.push({ name, temp, sclk });
            }
        }
        if (vendor === 'intel') {
            const intelSections = sensorsText.split(/\n(?=i915|intel-gpu)/);
            for (const section of intelSections) {
                if (!section.match(/i915|intel-gpu/)) continue;
                const nameMatch = section.match(/(i915|intel-gpu)-pci-([\w:-]+)/);
                const name = nameMatch ? `Intel GPU (${nameMatch[2] || nameMatch[1]})` : 'Intel GPU';
                const tempMatch = section.match(/temp[1-9]*:\s+\+([\d.]+)°C/);
                const temp = tempMatch ? tempMatch[1] : undefined;
                const clkMatch = section.match(/GT core:\s+([\d.]+) MHz/);
                const clk = clkMatch ? clkMatch[1] : undefined;
                results.push({ name, temp, clk });
            }
        }
        return results;
    }

    async _getIntelGpuTopStats() {
        try {
            const igttPath = await this._executeCommand(['which', 'intel_gpu_top']);
            if (!igttPath.trim()) return null;
            const output = await this._executeCommand(['intel_gpu_top', '-J', '-s', '1000']);
            const lines = output.trim().split('\n').filter(Boolean);
            let stats = null;
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const obj = JSON.parse(lines[i]);
                    if (obj && obj.engines) {
                        stats = obj;
                        break;
                    }
                } catch (e) { }
            }
            if (!stats) return null;
            const freq = stats.frequency ? stats.frequency.actual : undefined;
            const freqMax = stats.frequency ? stats.frequency.rp0 : undefined;
            const power = stats.power ? stats.power['GPU'] : undefined;
            const temp = stats.temperature ? stats.temperature['GPU'] : undefined;
            let utilization = 0;
            if (stats.engines) {
                for (const eng of Object.values(stats.engines)) {
                    if (eng.busy !== undefined) utilization += eng.busy;
                }
                utilization = Math.round(utilization);
            }
            return { freq, freqMax, power, temp, utilization };
        } catch (e) {
            return null;
        }
    }

    // Fallback: Try to get clockspeed from /sys/class/drm/card*/device/ for any GPU if not already set
    async _addFallbackClockspeed(gpus) {
        const fs = imports.gi.Gio;
        try {
            const cardDirs = GLib.glob_sync('/sys/class/drm/card*/device/', 0, null);
            for (let i = 0; i < gpus.length; i++) {
                const gpu = gpus[i];
                if (!gpu.clockspeed) {
                    for (const cardDir of cardDirs) {
                        // Try common files for clockspeed
                        const freqFiles = ['gpu_freq', 'pp_dpm_sclk', 'pp_dpm_mclk', 'pp_cur_state', 'pp_dpm_pcie', 'clock', 'current_freq'];
                        for (const file of freqFiles) {
                            const path = cardDir + file;
                            try {
                                const fileObj = fs.File.new_for_path(path);
                                if (fileObj.query_exists(null)) {
                                    const [ok, contents] = fileObj.load_contents(null);
                                    if (ok) {
                                        const text = contents.toString();
                                        // Try to extract MHz value
                                        const match = text.match(/(\d+)(?:\s*MHz)?/);
                                        if (match) {
                                            gpu.clockspeed = match[1];
                                            break;
                                        }
                                    }
                                }
                            } catch (e) { }
                        }
                        if (gpu.clockspeed) break;
                    }
                }
            }
        } catch (e) { }
        return gpus;
    }

    _formatGpuInfo(gpu, idx) {
        // First line: VRAM and Temp (with emojis)
        let line1 = `GPU${idx} - [ ${gpu.name} ]`;
        const vramFields = [];
        if (gpu.vramUsed && gpu.vramTotal) {
            const load = Math.round((parseInt(gpu.vramUsed) / parseInt(gpu.vramTotal)) * 100);
            const vramEmoji = this._getStatusEmoji(load, [90, 70, 50, 30]);
            vramFields.push(`${vramEmoji} VRAM: ${gpu.vramUsed}MB / ${gpu.vramTotal}MB | ${load}% |`);
        }
        if (gpu.temp) {
            const tempNum = parseFloat(gpu.temp);
            const tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
            vramFields.push(`${tempEmoji} Temp: ${gpu.temp} °C`);
        }
        if (vramFields.length) line1 += '\n' + vramFields.join(' ');
        let line2 = '';
        if (gpu.clockspeed && gpu.clockspeedMax) {
            const clkNum = parseFloat(gpu.clockspeed);
            const clkEmoji = this._getStatusEmoji(clkNum, [2000, 1500, 1000, 500, 200, 0]);
            line2 = `${clkEmoji} Clockspeed: ${gpu.clockspeed} / ${gpu.clockspeedMax} MHz`;
        } else if (gpu.clockspeed) {
            const clkNum = parseFloat(gpu.clockspeed);
            const clkEmoji = this._getStatusEmoji(clkNum, [2000, 1500, 1000, 500, 200, 0]);
            line2 = `${clkEmoji} Clockspeed: ${gpu.clockspeed} MHz`;
        }
        return line2 ? `${line1}\n${line2}` : line1;
    }

    _getGpuInfoAsync(callback) {
        (async () => {
            let allGpus = [];
            const [nvidia, amd, intel] = await Promise.all([
                this._getNvidiaInfo(),
                this._getAmdInfo(),
                this._getIntelInfo()
            ]);
            for (const arr of [nvidia, amd, intel]) {
                for (const gpu of arr) {
                    // Avoid duplicate names
                    if (!allGpus.some(g => g.name === gpu.name)) {
                        allGpus.push(gpu);
                    }
                }
            }
            // Fallback: try to add clockspeed for any GPU missing it
            allGpus = await this._addFallbackClockspeed(allGpus);
            const result = allGpus.length > 0
                ? allGpus.map((gpu, idx) => this._formatGpuInfo(gpu, idx)).join('\n\n')
                : '';
            callback(result);
        })();
    }

    getInfo() {
        return this.getGPUInfo();
    }
} 