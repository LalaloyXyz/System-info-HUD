import { BaseModule } from './baseModule.js';
import GLib from 'gi://GLib';

export class GPUModule extends BaseModule {
    constructor() {
        super(2000);
        this._refreshPromise = null;
    }

    async getGPUInfo() {
        if (this._isCacheValid())
            return this._cache.data;
        if (!this._refreshPromise) {
            this._refreshPromise = this._collectGPUInfo()
                .then(gpus => {
                    const result = gpus.map((gpu, index) => this._formatGpuInfo(gpu, index)).join('\n\n');
                    this._updateCache(result);
                    return result;
                })
                .catch(e => {
                    logError(e, 'System HUD: Error reading GPU info');
                    return this._cache.data ?? '';
                })
                .finally(() => { this._refreshPromise = null; });
        }
        return this._cache.data ?? await this._refreshPromise;
    }

    _pciAddress(value) {
        const match = value?.match(/(?:([\da-f]+):)?([\da-f]{2}:[\da-f]{2}\.[\da-f])/i);
        return match ? `${(match[1] ?? '0').padStart(4, '0').slice(-4)}:${match[2]}`.toLowerCase() : null;
    }

    _hasExecutable(bin) {
        return GLib.find_program_in_path(bin) !== null;
    }

    async _number(path, scale = 1) {
        const text = (await this._readFile(path, true)).trim();
        if (!text || !/^-?[\d.]+$/.test(text))
            return undefined;
        const value = Number(text) / scale;
        return Number.isFinite(value) ? value : undefined;
    }

    async _getNvidiaInfo() {
        if (!this._hasExecutable('nvidia-smi'))
            return [];
        const output = await this._executeCommand([
            'nvidia-smi',
            '--query-gpu=pci.bus_id,name,memory.total,memory.used,temperature.gpu,utilization.gpu',
            '--format=csv,noheader,nounits'
        ]);
        const gpus = [];
        for (const line of output.trim().split('\n')) {
            const [bus, name, total, used, temp, utilization] = line.split(',').map(value => value.trim());
            const pci = this._pciAddress(bus);
            if (!pci || !name)
                continue;
            gpus.push({ pci, name, vramTotal: parseFloat(total), vramUsed: parseFloat(used),
                temp: parseFloat(temp), utilization: parseFloat(utilization) });
        }
        // Clock support varies. Failure here must not discard the other metrics.
        const clockOutput = await this._executeCommand([
            'nvidia-smi', '--query-gpu=pci.bus_id,clocks.current.graphics,clocks.max.graphics',
            '--format=csv,noheader,nounits'
        ]);
        for (const line of clockOutput.trim().split('\n')) {
            const [bus, current, max] = line.split(',').map(value => value.trim());
            const gpu = gpus.find(item => item.pci === this._pciAddress(bus));
            if (gpu) {
                gpu.clockspeed = parseFloat(current);
                gpu.clockspeedMax = parseFloat(max);
            }
        }
        return gpus;
    }

    async _getAmdInfo() {
        if (!this._hasExecutable('rocm-smi'))
            return [];
        const output = await this._executeCommand(['rocm-smi', '--showbus', '--showproductname',
            '--showmeminfo', 'vram', '--showtemp', '--showuse', '--json']);
        try {
            return Object.values(JSON.parse(output)).flatMap(info => {
                const pci = this._pciAddress(info['PCI Bus']);
                if (!pci)
                    return [];
                return [{ pci, name: info['Card series'],
                    vramTotalBytes: parseFloat(info['VRAM Total Memory (B)']),
                    vramUsedBytes: parseFloat(info['VRAM Used Memory (B)']),
                    temp: parseFloat(info['Temperature (Sensor edge) (C)']),
                    utilization: parseFloat(info['GPU use (%)']) }];
            });
        } catch (_) {
            return [];
        }
    }

    async _getDrmInfo(card, pciNames) {
        const cardPath = `/sys/class/drm/${card}`;
        const device = `${cardPath}/device`;
        const uevent = await this._readFile(`${device}/uevent`, true);
        const pci = this._pciAddress(uevent.match(/^PCI_SLOT_NAME=(.+)$/m)?.[1]);
        const driver = uevent.match(/^DRIVER=(.+)$/m)?.[1];
        const vendor = (await this._readFile(`${device}/vendor`, true)).trim().toLowerCase();
        const gpu = { pci, card, name: pciNames.get(pci) ?? `${driver ?? 'DRM'} GPU (${card})` };
        gpu.vramUsedBytes = await this._number(`${device}/mem_info_vram_used`);
        gpu.vramTotalBytes = await this._number(`${device}/mem_info_vram_total`);
        gpu.utilization = await this._number(`${device}/gpu_busy_percent`);
        if (vendor === '0x1002') {
            const states = await this._readFile(`${device}/pp_dpm_sclk`, true);
            const match = states.match(/\b([\d.]+)\s*Mhz\s*\*/i);
            if (match)
                gpu.clockspeed = Number(match[1]);
        } else if (vendor === '0x8086') {
            gpu.clockspeed = await this._number(`${cardPath}/gt_cur_freq_mhz`);
            gpu.clockspeedMax = await this._number(`${cardPath}/gt_RP0_freq_mhz`);
            // Xe exposes frequency under device/tileN/gtN/freq0 rather than i915's card attributes.
            if (gpu.clockspeed === undefined) {
                for (const tile of await this._listDirs(device, /^tile\d+$/)) {
                    for (const gt of await this._listDirs(`${device}/${tile}`, /^gt\d+$/)) {
                        const path = `${device}/${tile}/${gt}/freq0`;
                        const frequency = await this._number(`${path}/act_freq`);
                        if (frequency !== undefined) {
                            gpu.clockspeed = frequency;
                            gpu.clockspeedMax = await this._number(`${path}/rp0_freq`);
                            break;
                        }
                    }
                    if (gpu.clockspeed !== undefined)
                        break;
                }
            }
        }
        for (const hwmon of await this._listDirs(`${device}/hwmon`, /^hwmon\d+$/)) {
            const path = `${device}/hwmon/${hwmon}`;
            gpu.temp = await this._number(`${path}/temp1_input`, 1000);
            if (gpu.temp !== undefined)
                break;
        }
        return gpu;
    }

    async _collectGPUInfo() {
        const pciNames = new Map();
        if (this._hasExecutable('lspci')) {
            const output = await this._executeCommand(['lspci', '-D', '-nn']);
            for (const line of output.split('\n')) {
                const match = line.match(/^(\S+)\s+(?:VGA compatible controller|3D controller|Display controller)(?:\s+\[[^\]]+\])?:\s*(.+)$/i);
                if (match) {
                    const name = match[2].replace(/\s+\[[0-9a-f]{4}:[0-9a-f]{4}\]/gi, '')
                        .replace(/\s+\(rev\s+[^)]+\)\s*$/i, '').trim();
                    pciNames.set(this._pciAddress(match[1]), name);
                }
            }
        }
        const gpus = [];
        for (const card of await this._listDirs('/sys/class/drm', /^card\d+$/)) {
            const gpu = await this._getDrmInfo(card, pciNames);
            if (!gpu.pci || !gpus.some(item => item.pci === gpu.pci))
                gpus.push(gpu);
        }
        const [nvidia, amd] = await Promise.all([this._getNvidiaInfo(), this._getAmdInfo()]);
        for (const gpu of [...nvidia, ...amd]) {
            const existing = gpus.find(item => item.pci === gpu.pci);
            if (existing) {
                for (const [key, value] of Object.entries(gpu)) {
                    if (value !== undefined && (typeof value !== 'number' || Number.isFinite(value))
                        && (nvidia.includes(gpu) || existing[key] === undefined))
                        existing[key] = value;
                }
            } else {
                gpu.name ??= pciNames.get(gpu.pci) ?? 'AMD GPU';
                gpus.push(gpu);
            }
        }
        for (const [pci, name] of pciNames) {
            if (!gpus.some(gpu => gpu.pci === pci))
                gpus.push({ pci, name });
        }
        return gpus;
    }

    _formatGpuInfo(gpu, idx) {
        // First line: VRAM and temperature status markers
        let line1 = `GPU${idx} - [ ${gpu.name} ]`;
        if (gpu.pci || gpu.card)
            line1 += `\nDevice: ${gpu.pci ?? gpu.card}`;
        const vramFields = [];
        if (Number.isFinite(gpu.vramUsedBytes) && gpu.vramTotalBytes > 0) {
            const usedMB = gpu.vramUsedBytes / 1000000;
            const totalGB = gpu.vramTotalBytes / 1000000000;
            const load = Math.round((gpu.vramUsedBytes / gpu.vramTotalBytes) * 100);
            const vramMarker = this._getStatusMarker(load, [90, 70, 50, 30]);
            vramFields.push(`${vramMarker} Memory Usage: ${usedMB.toFixed(2)} MB / ${totalGB.toFixed(2)} GB | ${load}%`);
        } else if (Number.isFinite(gpu.vramUsed) && gpu.vramTotal > 0) {
            const load = Math.round((parseInt(gpu.vramUsed) / parseInt(gpu.vramTotal)) * 100);
            const vramMarker = this._getStatusMarker(load, [90, 70, 50, 30]);
            vramFields.push(`${vramMarker} VRAM: ${gpu.vramUsed}MB / ${gpu.vramTotal}MB | ${load}% |`);
        }
        if (Number.isFinite(gpu.temp)) {
            const tempNum = parseFloat(gpu.temp);
            const tempMarker = this._getStatusMarker(tempNum, [80, 70, 55, 40, 30, 0]);
            vramFields.push(`${tempMarker} Temp: ${gpu.temp} °C`);
        }
        if (Number.isFinite(gpu.utilization))
            vramFields.push(`GPU Utilization: ${gpu.utilization}%`);
        if (vramFields.length) line1 += '\n' + vramFields.join(' ');
        let line2 = '';
        if (Number.isFinite(gpu.clockspeed) && gpu.clockspeedMax > 0) {
            const clkNum = parseFloat(gpu.clockspeed);
            const clkMarker = this._getStatusMarker(clkNum, [2000, 1500, 1000, 500, 200, 0]);
            line2 = `${clkMarker} Clockspeed: ${gpu.clockspeed} / ${gpu.clockspeedMax} MHz`;
        } else if (Number.isFinite(gpu.clockspeed)) {
            const clkNum = parseFloat(gpu.clockspeed);
            const clkMarker = this._getStatusMarker(clkNum, [2000, 1500, 1000, 500, 200, 0]);
            const frequency = Number.isFinite(clkNum) ? clkNum.toFixed(2) : gpu.clockspeed;
            line2 = `${clkMarker} GPU Frequency: ${frequency} MHz`;
        }
        return [line1, line2].filter(Boolean).join('\n');
    }

    getInfo() {
        return this.getGPUInfo();
    }
}
