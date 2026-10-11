// Run with: node tests/hud.js
// Exercise the real HUD lifecycle methods without a running Shell compositor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const laters = new Map();
let nextLaterId = 1;
const removed = [];
const source = readFileSync(new URL('../ui/uiManager.js', import.meta.url), 'utf8');
const UIManager = vm.runInNewContext(
    source.slice(source.indexOf('export class UIManager')).replace('export class', 'class') + '\nUIManager;', {
        Main: { layoutManager: { removeChrome: screen => removed.push(screen) } },
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

const timers = new Map();
let nextTimer = 1;
let animationComplete;
const marqueeSignals = new Map();
const marquee = { _useAnimation: true, _osMarqueeTimeoutId: 0, _device_OS: {
    remove_all_transitions() {}, connect() {},
    get_preferred_width: () => [0, 100],
    ease: options => { animationComplete = options.onComplete; },
} };
const marqueeSource = source.slice(source.indexOf('        const label = this._device_OS;'),
    source.indexOf('        this._device_Kernel = new St.Label'));
vm.runInNewContext(`(function () { ${marqueeSource} }).call(marquee);`, {
    marquee,
    viewport: { mapped: true, width: 20, connect: (name, callback) => marqueeSignals.set(name, callback) },
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
staleCompletion();
assert.equal(timers.size, 0, 'Animation completion after destruction cannot recreate the timer');
const closedMarquee = manager(actor());
closedMarquee._stopOSMarquee = () => { closedMarquee.marqueeStopped = true; };
closedMarquee.destroyMainScreen(false);
assert.equal(closedMarquee.marqueeStopped, true, 'HUD teardown explicitly stops the marquee');
console.log('PASS: HUD loading, closing, reopening, allocation, and marquee lifecycle checks');
