// Run with: gjs -m tests/hardware.js
import GLib from 'gi://GLib';
import { CPUModule } from '../modules/cpuModule.js';
import { GPUModule } from '../modules/gpuModule.js';
import { BaseModule } from '../modules/baseModule.js';
import { StorageModule } from '../modules/storageModule.js';
import { NetworkModule } from '../modules/networkModule.js';
import { PowerModule } from '../modules/powerModule.js';
import { ProcessModule } from '../modules/processModule.js';

let checks = 0;
function assert(value, message) {
    checks++;
    if (!value)
        throw new Error(message);
}
function cpuFixture({ ids = [0, 1], cpuinfo = '', sensors = '', frequencies = {}, hwmonFiles = {} } = {}) {
    const cpu = new CPUModule();
    cpu._hasExecutable = async () => true;
    cpu._listDirs = async () => [...new Set(Object.keys(hwmonFiles).map(path => path.split('/')[4]))];
    cpu._executeCommand = async argv => argv[0] === 'sensors' ? sensors : '';
    cpu._readFile = async path => {
        if (Object.hasOwn(hwmonFiles, path))
            return hwmonFiles[path];
        if (path === '/proc/stat')
            return ids.map(id => `cpu${id} 100 0 0 100 0 0 0 0 0 0`).join('\n');
        if (path === '/proc/cpuinfo')
            return cpuinfo;
        const id = path.match(/cpu(\d+)\/cpufreq\/scaling_cur_freq$/)?.[1];
        return frequencies[id] ?? '';
    };
    return cpu;
}
const cpu = cpuFixture({ ids: [0, 2, 10], frequencies: { 0: '3500000', 2: '1200000', 10: '2800000' },
    cpuinfo: 'processor : 0\nmodel name : AMD Test\n\nprocessor : 2\n\nprocessor : 10',
    sensors: 'amdgpu-pci-0100\nedge: +80.0°C\n\nnvme-pci-0200\nComposite: +70.0°C' });
let info = await cpu.getCPUInfo();
assert(info.cpu === 'AMD Test', 'Missing lscpu must use /proc/cpuinfo model');
assert(info.core === 3 && info.coreDetails.map(core => core.index).join() === '0,2,10', 'Sparse online CPU IDs');
assert(info.coreDetails.map(core => core.speed).join() === '3500,1200,2800', 'Frequencies must stay with CPU IDs');
assert(info.coreDetails.every(core => core.temp === 'N/A'), 'Do not report GPU/SSD temperatures as CPU');
info = await cpuFixture({ cpuinfo: 'processor : 0\nphysical id : 0\ncore id : 0\n\nprocessor : 1\nphysical id : 1\ncore id : 0',
    sensors: 'coretemp-isa-0000\nPackage id 0: +60.0°C\nCore 0: +52.0°C\n\ncoretemp-isa-0001\nPackage id 1: +70.0°C\nCore 0: +65.0°C' }).getCPUInfo();
assert(info.coreDetails.map(core => core.temp).join() === '52,65', 'Multi-socket core temperatures must not overwrite');
info = await cpuFixture({ sensors: 'k10temp-pci-00c3\nTctl: +63.0°C' }).getCPUInfo();
assert(info.coreDetails.every(core => core.temp === '63'), 'AMD package temperature fallback');
const apuSensors = {
    '/sys/class/hwmon/hwmon0/name': 'amdgpu',
    '/sys/class/hwmon/hwmon0/in1_label': 'vddnb',
    '/sys/class/hwmon/hwmon0/temp1_input': '48000'
};
info = await cpuFixture({ hwmonFiles: apuSensors }).getCPUInfo();
assert(info.temperatureSource === 'igpu' && info.coreDetails.every(core => core.temp === '48'),
    'An identified AMD APU temperature is the shared fallback when CPU sensors are absent');
info = await cpuFixture({ sensors: 'k10temp-pci-00c3\nTctl: +63.0°C', hwmonFiles: apuSensors }).getCPUInfo();
assert(info.temperatureSource === 'cpu' && info.coreDetails.every(core => core.temp === '63'),
    'Real CPU temperatures take precedence over the iGPU estimate');
info = await cpuFixture({ hwmonFiles: { ...apuSensors, '/sys/class/hwmon/hwmon0/in1_label': 'vddmem' } }).getCPUInfo();
assert(info.coreDetails.every(core => core.temp === 'N/A'), 'Never use an unidentified or discrete GPU as a CPU estimate');
info = await cpuFixture({ hwmonFiles: { ...apuSensors, '/sys/class/hwmon/hwmon0/temp1_input': '' } }).getCPUInfo();
assert(info.coreDetails.every(core => core.temp === 'N/A'), 'Missing iGPU readings must not become zero degrees');
info = await cpuFixture({ hwmonFiles: apuSensors,
    cpuinfo: 'processor : 0\nphysical id : 0\n\nprocessor : 1\nphysical id : 1' }).getCPUInfo();
assert(info.coreDetails.every(core => core.temp === 'N/A'), 'Do not apply one iGPU reading across multiple CPU sockets');
info = await cpuFixture({ cpuinfo: 'processor : 0\n\nprocessor : 1\nHardware : ARM Board' }).getCPUInfo();
assert(info.cpu === 'ARM Board' && info.core === 2, 'ARM identification without lscpu');

const gpu = new GPUModule();
const files = {};
function card(index, vendor, bus, metrics = {}) {
    const path = `/sys/class/drm/card${index}/device`;
    files[`${path}/vendor`] = vendor;
    files[`${path}/uevent`] = `PCI_SLOT_NAME=${bus}\nDRIVER=test`;
    for (const [key, value] of Object.entries(metrics))
        files[`${path}/${key}`] = String(value);
}
card(0, '0x1002', '0000:01:00.0', { mem_info_vram_used: 0, mem_info_vram_total: 1000000000, gpu_busy_percent: 0, pp_dpm_sclk: '0: 200Mhz\n1: 1200Mhz *' });
card(1, '0x1002', '0000:02:00.0', { mem_info_vram_used: 500000000, mem_info_vram_total: 2000000000, gpu_busy_percent: 75, pp_dpm_sclk: '0: 300Mhz *' });
card(2, '0x8086', '0000:03:00.0');
files['/sys/class/drm/card2/gt_cur_freq_mhz'] = '900';
files['/sys/class/drm/card2/gt_RP0_freq_mhz'] = '1500';
gpu._readFile = async path => files[path] ?? '';
gpu._listDirs = async path => path === '/sys/class/drm' ? ['card0', 'card1', 'card2'] : [];
gpu._getNvidiaInfo = async () => [];
gpu._executeCommand = async () => '0000:01:00.0 Display controller [0380]: AMD Radeon [1002:1234]\n0000:02:00.0 VGA compatible controller [0300]: AMD Radeon [1002:1234]\n0000:03:00.0 VGA compatible controller: Intel UHD Graphics 620';
let gpus = await gpu._collectGPUInfo();
assert(gpus.length === 3, 'Do not merge two identical GPU models');
assert(gpus[0].clockspeed === 1200 && gpus[1].clockspeed === 300, 'Use active clock states from matching cards');
assert(gpus[0].utilization === 0 && gpus[1].utilization === 75, 'Keep GPU load with matching cards');
assert(gpus[2].name === 'Intel UHD Graphics 620' && gpus[2].clockspeed === 900, 'Intel names without square brackets and i915 clocks');
assert(gpu._formatGpuInfo(gpus[0], 0).includes('Memory Usage: 0.00 MB'), 'Zero VRAM usage is valid');
assert(!gpu._formatGpuInfo({ name: 'Unsupported', temp: NaN, utilization: NaN }, 0).includes('NaN'), 'Suppress unsupported NVIDIA values');
assert(gpu._pciAddress('00000000:03:00.0') === '0000:03:00.0', 'Normalize NVIDIA PCI domain');
// Test Xe frequency path rather than i915 attributes.
delete files['/sys/class/drm/card2/gt_cur_freq_mhz'];
files['/sys/class/drm/card2/device/tile0/gt0/freq0/act_freq'] = '1100';
files['/sys/class/drm/card2/device/tile0/gt0/freq0/rp0_freq'] = '2100';
gpu._listDirs = async path => path.endsWith('/device') ? ['tile0'] : path.endsWith('/tile0') ? ['gt0'] : [];
const xe = await gpu._getDrmInfo('card2', new Map());
assert(xe.clockspeed === 1100 && xe.clockspeedMax === 2100, 'Intel Xe frequency path');
let calls = 0;
const emptyGpu = new GPUModule();
emptyGpu._collectGPUInfo = async () => { calls++; return []; };
await Promise.all([emptyGpu.getGPUInfo(), emptyGpu.getGPUInfo()]);
assert(calls === 1, 'Deduplicate simultaneous GPU refreshes');
await emptyGpu.getGPUInfo();
assert(calls === 1, 'Cache an empty GPU result when no hardware is available');

const storage = new StorageModule();
storage._executeCommand = async () => 'Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 100G 10G 90G 10% /media/My Disk';
assert((await storage.getStorageInfo()).includes('/media/My Disk'), 'Storage mount paths with spaces');
const network = new NetworkModule();
network._readFile = async () => 'header\nheader\neth0: 10 0 0 0 0 0 0 0 20 0 0 0 0 0 0 0';
network._networkInterface = { lastIface: 'eth0', lastRx: 100, lastTx: 100, lastTimestamp: Date.now() - 2000 };
assert((await network.getNetworkSpeed()).download === '0.00 B/s', 'Network counters resetting must not give negative speed');
const process = new ProcessModule();
const row = { pid: 22, started: 'same' };
process._updateGpu([row], { time: 1e9, processes: { 22: { client: { device: 'gpu', engines: { render: { time: 1e8, capacity: 1 } } } } } });
assert(row.gpu === null, 'First process GPU sample is unknown');
process._updateGpu([row], { time: 2e9, processes: { 22: { client: { device: 'gpu', engines: { render: { time: 6e8, capacity: 1 } } } } } });
assert(row.gpu === 50, 'Process GPU counter interval');
process.destroy();
const base = new BaseModule();
assert((await base._executeCommand(['sh', '-c', 'printf "%s" "$LC_ALL"'])) === 'C', 'Force locale-independent command output');
assert((await base._readFile('/proc/stat')).startsWith('cpu'), 'Decode actual procfs bytes');
const nvidia = new GPUModule();
nvidia._hasExecutable = () => true;
nvidia._executeCommand = async argv => argv[1].includes('clocks') ? ''
    : '00000000:04:00.0, RTX Test, 8192, 0, N/A, 0\n00000000:05:00.0, RTX Test, 8192, 512, 65, 90';
const cards = await nvidia._getNvidiaInfo();
assert(cards.length === 2 && cards[0].vramUsed === 0 && cards[1].utilization === 90, 'NVIDIA devices and zero-valued metrics survive clock failure');
assert(!nvidia._formatGpuInfo(cards[0], 0).includes('N/A'), 'NVIDIA unsupported temperatures are omitted');
const amd = new GPUModule();
amd._hasExecutable = () => true;
amd._executeCommand = async argv => {
    assert(argv.includes('--showmeminfo') && argv.includes('vram'), 'ROCm must request actual VRAM byte values');
    return JSON.stringify({ card0: { 'PCI Bus': '0000:06:00.0', 'Card series': 'AMD Test',
        'VRAM Total Memory (B)': '1000', 'VRAM Used Memory (B)': '0',
        'Temperature (Sensor edge) (C)': '60', 'GPU use (%)': '30' } });
};
const amdCards = await amd._getAmdInfo();
assert(amdCards[0].pci === '0000:06:00.0' && amdCards[0].vramTotalBytes === 1000 && amdCards[0].temp === 60, 'ROCm metrics matched by PCI address');
const missing = new GPUModule();
missing._hasExecutable = () => false;
missing._listDirs = async () => [];
assert(await missing.getGPUInfo() === '', 'No tools or DRM hardware must return an empty GPU result');
const power = new PowerModule();
power._executeCommand = async argv => argv[1] === '-e' ? '/org/freedesktop/UPower/devices/battery_mouse'
    : 'power supply: no\npercentage: 75%';
assert(await power.getPowerInfo() === 'No battery found', 'Desktop mouse battery is not the computer battery');
power.clearCache();
power._executeCommand = async argv => argv[1] === '-e' ? '/org/freedesktop/UPower/devices/battery_CMB0'
    : 'power supply: yes\npresent: yes\nstate: discharging\npercentage: 50%\nenergy-rate: 5 W';
assert((await power.getPowerInfo()).includes('50.0%'), 'Laptop batteries with non-BAT names');
print(`PASS: ${checks} hardware regression checks`);
