// Requires the GNOME Shell and Mutter typelib/library directories in the environment.
// Uses stand-in actors to check rendering logic, not actual on-screen rendering.
import { updateGPUData, updateCPUData, updateMemoryData, updateStorageData, updatePowerData, updateNetworkData } from '../updateData.js';
import { GPUModule } from '../modules/gpuModule.js';
import { ProcessPage } from '../processPage.js';
class Actor {
    constructor(props = {}) { Object.assign(this, props); this.children = []; this.parent = null; this.signals = new Map(); }
    add_child(actor) { if (this.destroyed || actor.destroyed) throw new Error('Disposed actor'); actor.parent = this; this.children.push(actor); }
    get_children() { return this.children.slice(); }
    get_parent() { if (this.destroyed) throw new Error('Disposed actor'); return this.parent; }
    remove_child(actor) { this.children = this.children.filter(child => child !== actor); actor.parent = null; }
    destroy() { for (const child of this.get_children()) child.destroy(); this.parent?.remove_child(this); this.destroyed = true; this.signals.get('destroy')?.(this); }
    connect(signal, callback) { this.signals.set(signal, callback); }
    set_style(style) { this.style = style; }
    queue_repaint() {}
    show() {}
    hide() {}
}
const St = { BoxLayout: Actor, Label: Actor, Widget: Actor, DrawingArea: class extends Actor {} };
const colors = { text: '#fff', secondaryText: '#aaa' };
let checks = 0;
function assert(value, message) { checks++; if (!value) throw new Error(message); }
function labels(actor) { return [actor.text ?? '', ...actor.children.flatMap(labels)]; }
const gpu = new GPUModule();
const a = { pci: '0000:01:00.0', name: 'AMD [AMD/ATI] Radeon', temp: 30, utilization: 10 };
const b = { pci: '0000:02:00.0', name: 'AMD [AMD/ATI] Radeon', temp: 80, utilization: 90 };
const box = new Actor();
updateGPUData({ gpuBox: box, animationsEnabled: false, gpuHistories: [
    { memory: [], temperature: [30], load: [10] }, { memory: [], temperature: [80], load: [90] }
] }, `${gpu._formatGpuInfo(a, 0)}\n\n${gpu._formatGpuInfo(b, 1)}`, colors, St);
assert(labels(box).includes('GPU 0 · AMD [AMD/ATI] Radeon'), 'Preserve full PCI names containing brackets');
assert(labels(box).some(text => text.includes('Peak 30.0°C')) && labels(box).some(text => text.includes('Peak 80.0°C')), 'Independent temperature histories');
const graphs = box.children.filter(child => child instanceof St.DrawingArea);
assert(graphs.length === 4, 'Each card has its own load and temperature graph');
updateGPUData({ gpuBox: box, animationsEnabled: false, gpuHistories: [
    { memory: [], temperature: [80, 81], load: [90, 91] }
] }, gpu._formatGpuInfo({ ...b, temp: 81, utilization: 91 }, 0), colors, St);
const remaining = box.children.filter(child => child instanceof St.DrawingArea);
assert(remaining[0] === graphs[2] && remaining[1] === graphs[3], 'Keep surviving GPU graph by PCI address after card removal');
assert(graphs[0].destroyed && graphs[1].destroyed, 'Release removed GPU graphs');
const cpuBox = new Actor();
updateCPUData({ coreBox: cpuBox, showGraph: false }, { cpu: 'ARM', core: 1,
    coreDetails: [{ index: 0, name: 'Core-00', load: 15, speed: 1000, temp: 'N/A' }] }, colors, St);
assert(labels(cpuBox).includes('N/A °C'), 'Unavailable CPU temperature remains visible as N/A');
updateCPUData({ coreBox: cpuBox, showGraph: false }, { cpu: 'AMD APU', core: 1, temperatureSource: 'igpu',
    coreDetails: [{ index: 0, name: 'Core-00', load: 15, speed: 1000, temp: '48' }] }, colors, St);
assert(labels(cpuBox).includes('48 °C') && !labels(cpuBox).some(text => text.includes('iGPU temperature estimate')),
    'The fallback temperature remains visible without the note below the CPU rows');
const memoryBox = new Actor();
updateMemoryData({ memoryBox }, { percent: '10%', use: '1 GB', max: '10 GB', swapUse: '0', swapMax: '0 GB', cache: '1 GB' }, colors, St);
assert(labels(memoryBox).includes('RAM'), 'Memory UI renders');
const storageBox = new Actor();
updateStorageData({ storageBox }, '- /dev/sda1 (  /media/My Disk  )\n[-] [ 10G / 100G ] [10%] Avail 90G\n', colors, St);
assert(labels(storageBox).some(text => text.includes('/media/My Disk')), 'Storage UI retains mount spaces');
const powerBox = new Actor();
updatePowerData({ powerBox }, 'No battery found', colors, St);
assert(labels(powerBox).includes('No battery found'), 'Desktop battery fallback UI');
const speed = new Actor();
updateNetworkData({ wifiSpeedLabel: speed }, { networkSpeed: { download: '0 B/s', upload: '0 B/s' }, wifiSSID: 'Not connected' });
assert(speed.text.includes('0 B/s'), 'Offline network UI');

let completeRefresh;
const page = Object.create(ProcessPage.prototype);
Object.assign(page, {
    actor: new Actor({ visible: true }), _busy: false, _nextRefresh: 0,
    _module: { list: () => new Promise(resolve => completeRefresh = resolve), destroy() {} },
    _rows: new Map(), _appIcons: new Map(), _runningIcons: new Map(), _appPids: new Set(),
    _render: () => { throw new Error('Refresh touched a destroyed page'); },
});
const refresh = page.refresh();
page.destroy();
completeRefresh([]);
await refresh;
assert(page.actor === null, 'Closing the process page during a refresh releases the actor without rendering again');
print(`PASS: ${checks} UI logic checks (stand-in actors)`);
