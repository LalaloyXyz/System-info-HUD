// Run with: node tests/hud.js
// Exercise the real HUD lifecycle methods without a running Shell compositor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const laters = new Map();
let nextLaterId = 1;
const removed = [];
const animationSettings = { enable_animations: true, slow_down_factor: 1 };
const clipboardWrites = [];
class Layout {
    constructor(properties = {}) { Object.assign(this, properties); }
    add_child() {}
    connect() { return 1; }
    disconnect() {}
    set_size(width, height) { this.width = width; this.height = height; }
    set_width() {}
    set_height() {}
    set_position() {}
    grab_key_focus() {}
    show() { this.visible = true; }
    remove_all_transitions() {}
    destroy() {}
}
const source = readFileSync(new URL('../ui/uiManager.js', import.meta.url), 'utf8');
const UIManager = vm.runInNewContext(
    source.slice(source.indexOf('export class UIManager')).replace('export class', 'class') + '\nUIManager;', {
        Main: { layoutManager: {
            removeChrome: screen => removed.push(screen), addChrome() {},
            primaryMonitor: { x: 0, y: 0, width: 1920, height: 1080 },
        } },
        St: { BoxLayout: Layout, Widget: Layout, Button: Layout, Entry: Layout, ScrollBar: Layout,
            Settings: { get: () => animationSettings },
            Clipboard: { get_default: () => ({ set_text: (_type, text) => clipboardWrites.push(text) }) },
            ClipboardType: { CLIPBOARD: 0 },
        },
        Clutter: { ActorAlign: { CENTER: 0 }, BinLayout: class {},
            EVENT_STOP: 'stop', EVENT_PROPAGATE: 'propagate', ModifierType: { BUTTON1_MASK: 1 },
            AnimationMode: { EASE_OUT_QUAD: 'press', EASE_OUT_ELASTIC: 'elastic' },
        },
        verticalBox: {},
        ...Object.fromEntries(['Device', 'Network', 'Memory', 'Storage', 'Power', 'OS', 'CPU', 'GPU']
            .map(section => [`update${section}SectionStyle`, () => {}])),
        addButtonAnimation() {},
        ProcessPage: class {
            constructor() { this.actor = new Layout(); }
            getSnapshot() { return []; }
            destroy() {}
        },
        Meta: { LaterType: { BEFORE_REDRAW: 0 } },
        GLib: { SOURCE_REMOVE: false },
        global: { compositor: { get_laters: () => ({
            add: (_type, callback) => { const id = nextLaterId++; laters.set(id, callback); return id; },
            remove: id => laters.delete(id),
        }) } },
    });

function actor({ mapped = false, opacity = 0, allocated = false } = {}) {
    const signals = new Map();
    return {
        mapped, opacity, signals,
        set_pivot_point() {}, set_position() {}, set_scale() {},
        remove_all_transitions() {},
        connect: (_signal, callback) => { signals.set(1, callback); return 1; },
        disconnect: id => signals.delete(id),
        has_allocation: () => allocated,
        show() {},
        destroy() { this.destroyed = true; },
    };
}
function manager(screen) {
    const hud = Object.create(UIManager.prototype);
    Object.assign(hud, {
        _main_screen: screen, _useAnimation: true, _closingMainScreen: false,
        _openingMainScreen: true, _sectionRefreshTimeoutIds: [],
        _indicator: { menu: { isOpen: false }, add_style_class_name() {}, remove_style_class_name() {} },
        _setIndicatorTextVisible() {},
        _getIndicatorAnimationTarget: () => ({ x: 0, y: 0, scale_x: 0.1, scale_y: 0.1 }),
        _animateMainScreen() { this.animationStarted = true; },
    });
    return hud;
}

const hidden = actor();
const pending = manager(hidden);
pending.destroyMainScreen();
assert.equal(pending._main_screen, null, 'Closing during initial loading must destroy the hidden card immediately');
assert.equal(pending._closingMainScreen, false, 'Hidden card must not leave subsequent clicks blocked');
assert.equal(pending.animationStarted, undefined, 'Hidden card must not start an actor timeline');

const visible = actor({ mapped: true, opacity: 255 });
const closing = manager(visible);
closing._openingMainScreen = false;
closing.destroyMainScreen();
assert.equal(closing.animationStarted, true, 'Visible card keeps its closing animation');
assert.equal(closing._closingMainScreen, true);
let stopped = false;
closing._mainScreenTimeline = { stop: () => { stopped = true; } };
closing.showMainScreen = async () => { closing._main_screen = actor(); closing.reopened = true; };
closing._toggleMainScreenFromIndicator();
assert.equal(stopped, true, 'Click during closing stops the old timeline');
assert.equal(visible.destroyed, true);
assert.equal(closing.reopened, true, 'Click during closing must reopen instead of being ignored');

const allocated = actor({ allocated: true });
const opening = manager(allocated);
opening._animateOpen(allocated, 100, 200);
assert.equal(laters.size, 1, 'Already allocated card must schedule opening without a new allocation signal');
assert.equal(allocated.signals.size, 0);
const callback = [...laters.values()][0];
laters.clear();
callback();
assert.equal(opening.animationStarted, true);

const unallocated = actor();
const waiting = manager(unallocated);
waiting._animateOpen(unallocated, 100, 200);
assert.equal(laters.size, 0, 'Unallocated card must wait for allocation');
[...unallocated.signals.values()][0]();
assert.equal(laters.size, 1);
waiting.destroyMainScreen(false);
assert.equal(laters.size, 0, 'Closing while waiting cancels the queued opening');

function coldManager() {
    const hud = manager(null);
    Object.assign(hud, {
        _useAnimation: false, _popupWidthPercent: 42, _popupHeightPercent: 42,
        _systemLink: { _worker: {} }, _displayCache: {}, _nextRefreshAt: {}, _refreshIntervals: {},
        _updateThemeColors: () => ({}), _createHeaderButtons() {}, _enableDrag() {},
        _stylePageButtons() {}, _switchPage() {},
        _createLeftColumn: async () => {}, _createRightColumn: async () => {},
        _restartUpdateLoop() { this.loopStarted = true; },
    });
    return hud;
}

const slow = coldManager();
let requests = 0;
slow._runSectionUpdate = () => { requests++; return new Promise(() => {}); };
let opened = false;
slow.showMainScreen().then(() => { opened = true; });
await new Promise(setImmediate);
assert.equal(opened, true, 'A stalled collector must not block the initial open');
assert.equal(slow._main_screen.visible, true, 'The HUD must be visible before telemetry arrives');
assert.equal(slow.loopStarted, true, 'Opening must start the regular telemetry update loop');
assert.equal(slow._main_screen.width, 806, 'HUD width follows the selected monitor percentage');
assert.equal(slow._main_screen.height, 453, 'HUD height follows the selected monitor percentage');
slow._updateAllInfo();
assert.equal(requests, 8, 'All telemetry sections still load through the update loop');
slow.destroyMainScreen(false);

const abandoned = coldManager();
let finishColumns;
abandoned._createLeftColumn = () => new Promise(resolve => { finishColumns = resolve; });
const abandonedOpen = abandoned.showMainScreen();
const abandonedScreen = abandoned._main_screen;
abandoned.destroyMainScreen(false);
finishColumns();
await abandonedOpen;
assert.equal(abandonedScreen.visible, false, 'Closing during construction must not show a destroyed card');
assert.equal(abandoned.loopStarted, undefined, 'Closing during construction must not restart updates');

const timers = new Map();
let nextTimer = 1;
let animationComplete;
const marqueeSignals = new Map();
const labelSignals = new Map();
const marquee = { _useAnimation: true, _osMarqueeTimeoutId: 0, _device_OS: {
    remove_all_transitions() {},
    connect: (name, callback) => { labelSignals.set(name, callback); return name; },
    disconnect: name => labelSignals.delete(name),
    get_preferred_width: () => [0, 100],
    ease: options => { animationComplete = options.onComplete; },
} };
const marqueeSource = source.slice(source.indexOf('        const label = this._device_OS;'),
    source.indexOf('        this._device_Kernel = new St.Label'));
vm.runInNewContext(`(function () { ${marqueeSource} }).call(marquee);`, {
    marquee,
    viewport: { mapped: true, width: 20,
        connect: (name, callback) => { marqueeSignals.set(name, callback); return name; },
        disconnect: name => marqueeSignals.delete(name),
    },
    Clutter: { AnimationMode: { LINEAR: 0 } },
    GLib: {
        PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
        timeout_add: (_priority, _delay, callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
        source_remove: id => timers.delete(id),
    },
});
marquee._updateOSMarquee();
const oldTimer = marquee._osMarqueeTimeoutId;
marquee._updateOSMarquee();
assert(!timers.has(oldTimer) && timers.size === 1, 'Restart removes the previous marquee timer');
const tick = timers.get(marquee._osMarqueeTimeoutId);
timers.delete(marquee._osMarqueeTimeoutId);
tick();
const staleCompletion = animationComplete;
marquee._updateOSMarquee();
staleCompletion();
assert.equal(timers.size, 1, 'A replaced animation cannot schedule a second marquee timer');
marqueeSignals.get('destroy')();
assert.equal(timers.size, 0, 'Actor destruction immediately removes the marquee timer');
assert.equal(marqueeSignals.size + labelSignals.size, 0, 'Cleanup disconnects every marquee signal');
assert.equal(marquee._updateOSMarquee, null);
assert.equal(marquee._stopOSMarquee, null);
staleCompletion();
assert.equal(timers.size, 0, 'Animation completion after destruction cannot recreate the timer');
const closedMarquee = manager(actor());
closedMarquee._stopOSMarquee = () => { closedMarquee.marqueeStopped = true; };
closedMarquee.destroyMainScreen(false);
assert.equal(closedMarquee.marqueeStopped, true, 'HUD teardown explicitly stops the marquee');
const graphSource = readFileSync(new URL('../ui/updateData.js', import.meta.url), 'utf8');
const graphSignals = new Map();
const graph = { mapped: true, queue_repaint() {},
    connect: (name, callback) => graphSignals.set(name, callback),
};
const updateGraphMotion = vm.runInNewContext(
    graphSource.slice(graphSource.indexOf('const DETAIL_LABEL_STYLE'), graphSource.indexOf('const TOOL_HELP')) + '\nupdateGraphMotion;', {
        GLib: {
            PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false, SOURCE_CONTINUE: true,
            get_monotonic_time: () => 0,
            timeout_add: (_priority, _delay, callback) => { const id = nextTimer++; timers.set(id, callback); return id; },
            source_remove: id => timers.delete(id),
        },
    });
const graphBox = {};
updateGraphMotion(graph, [10], graphBox);
updateGraphMotion(graph, [10, 20], graphBox);
assert.equal(timers.size, 1, 'A new graph sample starts its scrolling timer');
graph.mapped = false;
graphSignals.get('notify::mapped')();
assert.equal(timers.size, 0, 'Unmapping a graph removes its scrolling timer');
graph.mapped = true;
graphSignals.get('notify::mapped')();
assert.equal(timers.size, 1, 'Remapping resumes a graph animation');
graphSignals.get('destroy')();
assert.equal(timers.size, 0, 'Graph destruction removes its scrolling timer immediately');
const dragHandlers = new Map();
const dragHandle = { connect: (name, callback) => dragHandlers.set(name, callback) };
const dragScreen = {
    x: 100, y: 100, scale_x: 1, scale_y: 1, translation_x: 0, translation_y: 0,
    get_position() { return [this.x, this.y]; },
    positionWrites: 0,
    set_position(x, y) { this.x = x; this.y = y; this.positionWrites++; },
    set_scale(x, y) { this.scale_x = x; this.scale_y = y; },
    set_pivot_point() {}, remove_transition() {}, remove_all_transitions() {},
    ease(options) { this.lastEase = options; },
};
const dragging = manager(dragScreen);
dragging._openingMainScreen = false;
dragging._enableDrag(dragHandle);
const dragEvent = (x, y, pressed = true, source = dragHandle) => ({
    get_button: () => 1, get_coords: () => [x, y], get_source: () => source, get_state: () => pressed ? 1 : 0,
});
const sendDrag = (name, event) => dragHandlers.get(name)(dragHandle, event);
assert.equal(sendDrag('button-press-event', dragEvent(120, 120, true, new Layout())), 'propagate',
    'Interactive controls keep their normal click behavior');
sendDrag('button-press-event', dragEvent(120, 120));
assert.equal(dragScreen.lastEase.scale_y, 0.97, 'Press squashes the HUD like Now Playing');
sendDrag('motion-event', dragEvent(190, 140));
sendDrag('motion-event', dragEvent(200, 150));
sendDrag('motion-event', dragEvent(210, 160));
assert.equal(laters.size, 1, 'Fast pointer events are coalesced into one update per frame');
const dragFrame = [...laters.values()][0];
laters.clear();
dragFrame();
assert.equal(dragScreen.positionWrites, 0, 'Pointer motion must not trigger HUD layout allocations');
assert.equal(dragScreen.x, 100);
assert.equal(dragScreen.y, 100);
assert.equal(dragScreen.translation_x, 90, 'The render transform follows the pointer delta exactly');
assert.equal(dragScreen.translation_y, 40);
assert(dragScreen.scale_x !== 1, 'Dragging keeps the directional jelly stretch');
sendDrag('button-release-event', dragEvent(210, 160, false));
assert.equal(dragScreen.lastEase.mode, 'elastic', 'Release springs back without moving the saved HUD position');
assert.equal(dragScreen.lastEase.translation_x, 0);
assert.equal(dragScreen.x, 190);
assert.equal(dragScreen.y, 140);
assert.equal(dragScreen.positionWrites, 1, 'Release commits the final layout position once');
assert.equal(dragScreen.translation_x, 0);
assert.equal(dragScreen.translation_y, 0);
sendDrag('button-press-event', dragEvent(210, 160));
sendDrag('motion-event', dragEvent(220, 170));
sendDrag('motion-event', dragEvent(220, 170, false));
assert.equal(dragScreen.lastEase.mode, 'elastic', 'Losing the pressed button releases the jelly pose');
assert.equal(laters.size, 0, 'Release cancels the pending drag frame');
assert.equal(dragScreen.x, 200, 'Release commits the latest pointer delta even before its frame renders');
assert.equal(sendDrag('motion-event', dragEvent(230, 180)), 'propagate');
animationSettings.enable_animations = false;
dragScreen.lastEase = null;
sendDrag('button-press-event', dragEvent(210, 160));
sendDrag('motion-event', dragEvent(240, 180));
sendDrag('button-release-event', dragEvent(240, 180, false));
assert.equal(dragScreen.lastEase, null, 'System animation preferences disable jelly transitions');
assert.equal(dragScreen.scale_x, 1);
assert.equal(dragScreen.translation_x, 0);
animationSettings.enable_animations = true;
sendDrag('button-press-event', dragEvent(240, 180));
sendDrag('motion-event', dragEvent(250, 190));
assert.equal(laters.size, 1);
dragHandlers.get('destroy')();
assert.equal(laters.size, 0, 'Actor destruction cancels its pending drag frame');
const copying = manager(actor());
copying._systemLink = { getAllInfo: async () => ({ network: {
    networkSpeed: { download: '2 MB/s', upload: '30 kB/s' },
    wifiSSID: 'Private Wi-Fi', publicIP: '203.0.113.1', lanIP: '192.168.1.2',
} }) };
await copying._copySystemInfoToClipboard();
assert.equal(clipboardWrites.length, 1, 'Copy writes one report to the clipboard');
assert(clipboardWrites[0].includes('Download: 2 MB/s, Upload: 30 kB/s'),
    'Copied network speeds must contain measured values');
assert(!/\[object Object\]|Private Wi-Fi|203\.0\.113\.1|192\.168\.1\.2/.test(clipboardWrites[0]),
    'Copied report omits IP addresses and the Wi-Fi name');
const pendingCopy = copying._copySystemInfoToClipboard();
copying.destroyMainScreen(false);
await pendingCopy;
assert.equal(clipboardWrites.length, 1, 'Closing during collection must not write a stale report');
const themed = manager(actor());
Object.assign(themed, {
    _profileBin: {}, _themeManager: { getThemeColors: () => ({}) },
    _displayCache: { gpu: 'Cached GPU information' },
    _updateGPUInfo(info) {
        assert.equal(info, 'Cached GPU information', 'Theme changes reuse cached GPU data without starting a cancellable request');
        this.gpuRestyled = true;
    },
});
themed._onThemeChanged();
assert(themed.gpuRestyled, 'Theme changes still repaint GPU information');
console.log('PASS: HUD lifecycle, graph timers, and jelly drag behavior');
