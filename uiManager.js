import { verticalBox, horizontalBox } from './modules/shellCompat.js';
import St from 'gi://St';
import { ProcessPage } from './processPage.js';
import { addButtonAnimation } from './modules/buttonAnimation.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { 
    ThemeManager, 
    updateCPUSectionStyle, 
    updateNetworkSectionStyle, 
    updateMemorySectionStyle, 
    updateStorageSectionStyle, 
    updatePowerSectionStyle, 
    updateOSSectionStyle, 
    updateDeviceSectionStyle, 
    updateGPUSectionStyle 
} from './themeManager.js';
import {
    updateCPUData,
    updateMemoryData,
    updateNetworkData,
    updateOSData,
    updateStorageData,
    updatePowerData,
    updateDeviceData,
    updateGPUData
} from './updateData.js';

export class UIManager {
    constructor(extension, systemLink) {
        this._extension = extension;
        this._systemLink = systemLink;
        this._main_screen = null;
        this._closingMainScreen = false;
        this._openingMainScreen = false;
        this._mainScreenTimeline = null;
        this._tabHighlightLaterId = 0;
        this._tabSwitchInProgress = false;
        this._pageSwitchInProgress = false;
        this._updateTimeoutId = null;
        this._copyButtonTimeoutId = null;
        this._sectionRefreshTimeoutIds = [];
        this._refreshIntervalMs = 1000;
        this._refreshMultipliers = {
            device: 1,
            network: 1.5,
            memory: 2,
            os: 600,
            storage: 30,
            power: 5,
            cpu: 2.5,
            gpu: 5,
        };
        this._refreshIntervals = {};
        this._nextRefreshAt = {};
        this._displayCache = {};
        this._processSnapshot = [];
        this._osDetails = null;
        this._osHoverTimeoutId = null;
        this._themeManager = new ThemeManager();
        this._themeChangeSignal = this._themeManager.connectThemeChanged(
            this._onThemeChanged.bind(this)
        );
        this._settings = null;
        this._settingsSignalIds = [];
        this._useAnimation = true;
        this._showCopyButton = true;
        this._showPowerSection = true;
        this._showCpuGraph = true;
        this._showGpuGraph = true;
        this._cpuCoreColors = [];
        this._popupWidthPercent = 42;
        this._popupHeightPercent = 42;
        this._labelTimeoutIds = [];
        this._updateInProgress = false;
        this._cpuLoadHistory = [];
        this._cpuTemperatureHistory = [];
        this._gpuHistories = new Map();
        this._lastCPUInfo = null;
        this._mainScreenKeyPressId = null;
        this._indicatorClickSignalId = null;
        this._indicatorTouchSignalId = null;
        this._lastIndicatorActivation = 0;
        this._applyRefreshInterval(this._refreshIntervalMs);

        try {
            this._settings = this._extension.getSettings();
            this._useAnimation = this._settings.get_boolean('enable-animations');
            this._showCopyButton = this._settings.get_boolean('show-copy-button');
            this._showPowerSection = this._settings.get_boolean('show-power-section');
            this._showCpuGraph = this._settings.get_boolean('show-cpu-graph');
            this._showGpuGraph = this._settings.get_boolean('show-gpu-graph');
            this._cpuCoreColors = this._settings.get_strv('cpu-core-colors');
            this._popupWidthPercent = this._settings.get_int('window-width-percent');
            this._popupHeightPercent = this._settings.get_int('window-height-percent');
            this._applyRefreshInterval(this._settings.get_int('refresh-interval-ms'));
            this._settingsSignalIds.push(this._settings.connect('changed::enable-animations', () => {
                this._useAnimation = this._settings.get_boolean('enable-animations');
                if (this._updateOSMarquee)
                    this._updateOSMarquee();
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::show-copy-button', () => {
                this._showCopyButton = this._settings.get_boolean('show-copy-button');
                if (this._main_screen && !this._closingMainScreen && this._copyButton)
                    this._copyButton.visible = this._showCopyButton;
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::refresh-interval-ms', () => {
                this._applyRefreshInterval(this._settings.get_int('refresh-interval-ms'));
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::show-power-section', () => {
                this._showPowerSection = this._settings.get_boolean('show-power-section');
                if (this._main_screen && !this._closingMainScreen && this._powerSection)
                    this._powerSection.visible = this._showPowerSection;
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::show-cpu-graph', () => {
                this._showCpuGraph = this._settings.get_boolean('show-cpu-graph');
                this._lastCPUInfo = null;
                this._queueSectionRefresh('cpu', 0);
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::show-gpu-graph', () => {
                this._showGpuGraph = this._settings.get_boolean('show-gpu-graph');
                this._queueSectionRefresh('gpu', 0);
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::cpu-core-colors', () => {
                this._cpuCoreColors = this._settings.get_strv('cpu-core-colors');
                this._lastCPUInfo = null;
                this._queueSectionRefresh('cpu', 0);
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::window-width-percent', () => {
                this._popupWidthPercent = this._settings.get_int('window-width-percent');
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::window-height-percent', () => {
                this._popupHeightPercent = this._settings.get_int('window-height-percent');
            }));
        } catch (e) {
            // Missing schemas/gschemas.compiled during development is non-fatal:
            // fall back to defaults.
            this._settings = null;
            this._settingsSignalIds = [];
        }
    }

    _applyRefreshInterval(intervalMs) {
        this._refreshIntervalMs = Math.max(500, Math.min(10000, intervalMs));
        this._refreshIntervals = {};

        for (const [section, multiplier] of Object.entries(this._refreshMultipliers))
            this._refreshIntervals[section] = Math.round(this._refreshIntervalMs * multiplier);

        this._nextRefreshAt = {};
        this._restartUpdateLoop();
    }

    _restartUpdateLoop() {
        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = null;
        }

        if (!this._main_screen)
            return;

        const updateLoopInterval = Math.min(this._refreshIntervalMs, 500);
        this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, updateLoopInterval, () => {
            if (this._updateInProgress)
                return GLib.SOURCE_CONTINUE;

            this._updateInProgress = true;
            this._updateAllInfo()
                .catch(e => {
                    logError(e, 'System HUD: Error updating HUD');
                })
                .finally(() => {
                    this._updateInProgress = false;
                });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _queueSectionRefresh(section, delayMs = 0) {
        if (!this._main_screen || this._closingMainScreen)
            return;
        if (this._displayCache[section] !== undefined) {
            this._runSectionUpdate(section, this._displayCache[section]).catch(error => {
                logError(error, `System HUD: Error restoring ${section} section`);
            });
        }
        if (this._openingMainScreen || this._tabSwitchInProgress || this._pageSwitchInProgress) {
            this._nextRefreshAt[section] = 0;
            return;
        }
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._sectionRefreshTimeoutIds = this._sectionRefreshTimeoutIds.filter(id => id !== timeoutId);
            this._runSectionUpdate(section).catch(error => {
                logError(error, `System HUD: Error updating ${section} section`);
            });
            return GLib.SOURCE_REMOVE;
        });
        this._sectionRefreshTimeoutIds.push(timeoutId);
    }

    _shouldRefreshSection(section, now) {
        return !this._nextRefreshAt[section] || now >= this._nextRefreshAt[section];
    }

    _markSectionRefreshed(section, now) {
        this._nextRefreshAt[section] = now + (this._refreshIntervals[section] || 1000);
    }

    async _runSectionUpdate(section, cachedInfo) {
        switch (section) {
        case 'device':
            await this._updateDeviceInfo(cachedInfo);
            break;
        case 'network':
            await this._updateNetworkInfo(cachedInfo);
            break;
        case 'memory':
            await this._updateMemoryInfo(cachedInfo);
            break;
        case 'os':
            await this._updateOSInfo(cachedInfo);
            break;
        case 'storage':
            await this._updateStorageInfo(cachedInfo);
            break;
        case 'power':
            await this._updatePowerInfo(cachedInfo);
            break;
        case 'cpu':
            await this._updateCPUInfo(cachedInfo);
            break;
        case 'gpu':
            await this._updateGPUInfo(cachedInfo);
            break;
        default:
            break;
        }
    }

    createIndicator() {
        this._indicator = new PanelMenu.Button(0.0, this._extension.metadata.name, false);
        this._indicator.add_style_class_name('panel-button');

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._indicator.add_child(this._label);

        const welcomeMessages = [
            "Welcome! Ready to make today great?",
            "Hello! Let's have an awesome day!",
            "Hi there! You've got this today!",
            "Welcome back! Time to shine!",
            "Hey! Today's full of possibilities!",
            "Greetings! Make today amazing!",
            "Welcome aboard! Let's do great things!",
            "Hi! Ready to conquer the day?"
          ];

        const welcomeText = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
        const infoText = 'Info';
        let i = 1;
        const typingInterval = 80; // ms per character
        this._label.text = '';

        let typingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, typingInterval, () => {
            this._label.text = welcomeText.slice(0, i);
            i++;
            if (i > welcomeText.length) {
                this._removeLabelTimeout(typingId);
                let pauseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5555, () => {
                    this._removeLabelTimeout(pauseId);
                    let j = welcomeText.length;
                    let eraseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, typingInterval, () => {
                        j--;
                        this._label.text = welcomeText.slice(0, j);
                        if (j === 0) {
                            this._removeLabelTimeout(eraseId);
                            let k = 1;
                            let infoId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, typingInterval, () => {
                                this._label.text = infoText.slice(0, k);
                                k++;
                                if (k > infoText.length) {
                                    this._removeLabelTimeout(infoId);
                                    return GLib.SOURCE_REMOVE;
                                }
                                return GLib.SOURCE_CONTINUE;
                            });
                            this._labelTimeoutIds.push(infoId);
                            return GLib.SOURCE_REMOVE;
                        }
                        return GLib.SOURCE_CONTINUE;
                    });
                    this._labelTimeoutIds.push(eraseId);
                    return GLib.SOURCE_REMOVE;
                });
                this._labelTimeoutIds.push(pauseId);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._labelTimeoutIds.push(typingId);

        // GNOME 49+ St.Button uses ClutterClickGesture internally, which can
        // consume press/release events before extension handlers see them.
        this._indicator.clear_actions();

        this._indicatorClickSignalId = this._indicator.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;

            if (Date.now() - this._lastIndicatorActivation < 300)
                return Clutter.EVENT_STOP;

            this._lastIndicatorActivation = Date.now();
            this._toggleMainScreenFromIndicator();
            return Clutter.EVENT_STOP;
        });

        this._indicatorTouchSignalId = this._indicator.connect('touch-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
                return Clutter.EVENT_PROPAGATE;

            if (Date.now() - this._lastIndicatorActivation < 300)
                return Clutter.EVENT_STOP;

            this._lastIndicatorActivation = Date.now();
            this._toggleMainScreenFromIndicator();
            return Clutter.EVENT_STOP;
        });

        Main.panel.addToStatusArea(this._extension.uuid, this._indicator);
    }

    _removeLabelTimeout(timeoutId) {
        this._labelTimeoutIds = this._labelTimeoutIds.filter(id => id !== timeoutId);
    }

    _toggleMainScreenFromIndicator() {
        if (this._closingMainScreen)
            this.destroyMainScreen(false);
        if (this._indicator.menu.isOpen)
            this._indicator.menu.close();

        if (this._main_screen) {
            this._indicator.remove_style_class_name('active');
            this.destroyMainScreen();
        } else {
            this._indicator.add_style_class_name('active');
            this.showMainScreen().catch(error => {
                logError(error, 'System HUD: failed to open HUD');
                this._indicator.remove_style_class_name('active');
                if (this._main_screen)
                    this.destroyMainScreen();
            });
        }
    }

    _updateThemeColors() {
        return this._themeManager.getThemeColors();
    }

    _onThemeChanged() {
        if (this._main_screen) {
            const themeColors = this._updateThemeColors();
            
            this._profileBin.style =  `
                background-image: url("file://${this._profileImagePath}");
                background-size: cover;
                background-position: center;
                border-radius: 360px;
                border: 2px solid ${themeColors.accent};
            `;

            if (this._closeButton) {
                this._closeButton.style = `background-color: #ff453a;
                    color: white; 
                    width: 34px;
                    border-radius: 18px;
                    border: 1px solid rgba(255, 255, 255, 0.24);
                    font-weight: bold;
                    font-size: 18px;`;
            }

            updateDeviceSectionStyle({
                deviceWithUptime: this._deviceWithUptime,
                deviceLabel: this._deviceLabel
            }, themeColors);
            updateNetworkSectionStyle({
                wifiSpeedLabel: this._wifiSpeedLabel,
                wifiLabel: this._wifiLabel,
                publicIPLabel: this._publicIPLabel,
                publicIPDescLabel: this._publicIPDescLabel,
                localIPLabel: this._localIPLabel,
                localIPDescLabel: this._localIPDescLabel
            }, themeColors);
            updateMemorySectionStyle({
                memoryUse: this._memoryUse,
                memorySwap: this._memorySwap,
                memoryCache: this._memoryCache,
                memoryHead: this._memoryHead
            }, themeColors);
            if (this._displayCache.memory !== undefined)
                this._updateMemoryInfo(this._displayCache.memory);
            updateStorageSectionStyle({
                storageBox: this._storageBox,
                storageHead: this._storageHead
            }, themeColors);
            if (this._displayCache.storage !== undefined)
                this._updateStorageInfo(this._displayCache.storage);
            updatePowerSectionStyle({
                powerShow: this._powerShow,
                powerHead: this._powerHead
            }, themeColors);
            if (this._displayCache.power !== undefined)
                this._updatePowerInfo(this._displayCache.power);
            updateOSSectionStyle({
                osPrefix: this._osPrefix,
                device_OS: this._device_OS,
                device_Kernel: this._device_Kernel
            }, themeColors);
            updateCPUSectionStyle({
                cpuHead: this._cpuHead,
                cpuName: this._cpuName,
                coreBox: this._coreBox
            }, themeColors, St);
            if (this._displayCache.cpu !== undefined)
                this._updateCPUInfo(this._displayCache.cpu);
            updateGPUSectionStyle({
                gpuHead: this._gpuHead,
                gpuBox: this._gpuBox
            }, themeColors, St);
            this._updateGPUInfo();
            if (this._processPage)
                this._stylePageButtons();
        }
    }

    _createColumn(width, height = null) {
        const themeColors = this._updateThemeColors();
        
        const column = new St.BoxLayout({
            ...verticalBox,
            style: `background-color: transparent; border: 0px solid ${themeColors.accent};`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        
        if (width) column.set_width(width);
        if (height) column.set_height(height);
        
        return column;
    }

    _withSectionIcon(label, iconName) {
        const row = new St.BoxLayout({
            ...horizontalBox,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 7px;'
        });
        row.add_child(new St.Icon({
            icon_name: iconName,
            icon_size: 16,
            style: 'color: white;'
        }));
        row.add_child(label);
        return row;
    }

    _enableDrag(actor) {
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let actorStartX = 0;
        let actorStartY = 0;

        actor.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const eventActor = event.get_source() ?? actor.get_stage()?.get_event_actor?.(event);
            for (let source = eventActor; source && source !== actor; source = source.get_parent()) {
                if (source instanceof St.Button || source instanceof St.Entry || source instanceof St.ScrollBar)
                    return Clutter.EVENT_PROPAGATE;
            }
            dragging = true;
            const [x, y] = event.get_coords();
            dragStartX = x;
            dragStartY = y;

            [actorStartX, actorStartY] = this._main_screen.get_position();
            return Clutter.EVENT_STOP;
        });

        actor.connect('motion-event', (actor, event) => {
            if (!dragging) return Clutter.EVENT_PROPAGATE;
            if (!(event.get_state() & Clutter.ModifierType.BUTTON1_MASK)) {
                dragging = false;
                return Clutter.EVENT_PROPAGATE;
            }
            const [x, y] = event.get_coords();
            const dx = x - dragStartX;
            const dy = y - dragStartY;
            this._main_screen.set_position(actorStartX + dx, actorStartY + dy);
            return Clutter.EVENT_STOP;
        });

        actor.connect('button-release-event', () => {
            if (!dragging)
                return Clutter.EVENT_PROPAGATE;

            dragging = false;
            return Clutter.EVENT_STOP;
        });
    }

    async showMainScreen() {
        const monitor = Main.layoutManager.primaryMonitor;
        const popupWidth = Math.floor(monitor.width * this._popupWidthPercent / 100);
        const popupHeight = Math.floor(monitor.height * this._popupHeightPercent / 100);

        this._main_screen = new St.BoxLayout({
            ...verticalBox,
            style: 'background-color: transparent;',
            reactive: true,
            can_focus: true,
            track_hover: true,
            visible: false,
            opacity: 0,
        });
        const screen = this._main_screen;
        this._openingMainScreen = true;

        const navigation = new St.BoxLayout({ height: 54, style: 'padding: 0 6px 8px;' });
        this._tabStrip = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        this._tabHighlight = new St.Widget({
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true, reactive: false,
        });
        this._tabHighlightTarget = null;
        this._tabStrip.add_child(this._tabHighlight);
        this._tabButtons = new St.BoxLayout({ style: 'spacing: 4px;' });
        this._tabStrip.add_child(this._tabButtons);
        this._statusButton = new St.Button({ label: 'System Status', can_focus: true, style_class: 'button' });
        this._processButton = new St.Button({ label: 'Processes', can_focus: true, style_class: 'button' });
        for (const button of [this._statusButton, this._processButton])
            addButtonAnimation(button, () => this._useAnimation);
        this._tabButtons.add_child(this._statusButton);
        this._tabButtons.add_child(this._processButton);
        for (const button of [this._statusButton, this._processButton])
            button.connect('notify::allocation', () => this._queueTabHighlight(false));
        navigation.add_child(this._tabStrip);
        navigation.add_child(new St.Widget({ x_expand: true }));
        this._createHeaderButtons(navigation);
        this._main_screen.add_child(navigation);
        this._pageContainer = new St.BoxLayout({
            ...verticalBox, x_expand: true, y_expand: true,
        });
        this._main_screen.add_child(this._pageContainer);
        this._pageStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true,
            clip_to_allocation: true,
        });
        this._pageContainer.add_child(this._pageStack);
        this._statusPage = new St.BoxLayout({ x_expand: true, y_expand: true });
        this._pageStack.add_child(this._statusPage);
        this._processPage = new ProcessPage(this._processSnapshot, () => this._useAnimation);
        this._processPage.actor.reactive = true;
        this._enableDrag(this._processPage.actor);
        this._pageStack.add_child(this._processPage.actor);
        this._showingProcesses = false;
        this._statusButton.connect('clicked', () => this._switchPage(false));
        this._processButton.connect('clicked', () => this._switchPage(true));
        this._stylePageButtons();
        this._switchPage(false);
        const contentHeight = Math.max(100, popupHeight - 54);

        const frontColumn = this._createColumn(Math.floor(popupWidth * 0.05));
        const leftColumn = this._createColumn(Math.floor(popupWidth * 0.44));
        const betweenColumn = this._createColumn(Math.floor(popupWidth * 0.03));
        const rightColumn = this._createColumn(Math.floor(popupWidth * 0.42));
        const bebackColumn = this._createColumn(Math.floor(popupWidth * 0.01));
        const backColumn = this._createColumn(Math.floor(popupWidth * 0.05));

        this._statusPage.add_child(frontColumn);
        this._statusPage.add_child(leftColumn);
        this._statusPage.add_child(betweenColumn);
        this._statusPage.add_child(rightColumn);
        this._statusPage.add_child(bebackColumn);
        this._statusPage.add_child(backColumn);

        // Enable dragging on non-button columns to avoid click conflicts.
        this._enableDrag(frontColumn);
        this._enableDrag(leftColumn);
        this._enableDrag(betweenColumn);
        this._enableDrag(rightColumn);
        this._enableDrag(bebackColumn);
        
        // Prepare the card offscreen before starting its entrance animation.
        this._main_screen.set_size(popupWidth, popupHeight);
        Main.layoutManager.addChrome(this._main_screen, {
            trackFullscreen: true,
        });

        try {
            this._mainScreenKeyPressId = this._main_screen.connect('key-press-event', (_actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this._indicator.remove_style_class_name('active');
                    this.destroyMainScreen();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (error) {
            logError(error, 'System HUD: failed to bind Escape close shortcut');
            this._mainScreenKeyPressId = null;
        }

        await Promise.allSettled([
            this._createLeftColumn(leftColumn, contentHeight),
            this._createRightColumn(rightColumn, contentHeight),
        ]);
        if (!await this._prepareInitialData(screen))
            return;

        const x = Math.floor((monitor.width - popupWidth) / 2) + monitor.x;
        const y = Math.floor((monitor.height - popupHeight) / 2) + monitor.y;
        if (this._useAnimation) {
            this._animateOpen(screen, x, y);
        } else {
            this._openingMainScreen = false;
            screen.set_position(x, y);
            screen.opacity = 255;
            screen.show();
        }
        screen.grab_key_focus();

        this._setIndicatorTextVisible(false);
        this._restartUpdateLoop();
    }

    async _prepareInitialData(screen) {
        if (this._main_screen !== screen || this._closingMainScreen)
            return false;
        const sections = ['device', 'network', 'memory', 'os', 'storage', 'power', 'cpu', 'gpu'];
        const missing = sections.filter(section => this._displayCache[section] === undefined);
        await Promise.allSettled(missing.map(section => this._runSectionUpdate(section).then(() => {
            this._markSectionRefreshed(section, Date.now());
        })));
        return this._main_screen === screen && !this._closingMainScreen;
    }

    _getIndicatorAnimationTarget(screen) {
        const [buttonX, buttonY] = this._indicator.get_transformed_position();
        const [buttonWidth, buttonHeight] = this._indicator.get_transformed_size();
        const [width, height] = screen.get_size();
        return {
            x: buttonX + buttonWidth / 2 - width / 2,
            y: buttonY + buttonHeight / 2 - height / 2,
            scale_x: Math.min(1, Math.min(120, Math.max(64, buttonWidth)) / width),
            scale_y: Math.min(1, Math.max(24, buttonHeight) / height),
        };
    }

    _animateOpen(screen, x, y) {
        const origin = this._getIndicatorAnimationTarget(screen);
        screen.set_pivot_point(0.5, 0.5);
        screen.set_position(origin.x, origin.y);
        screen.set_scale(origin.scale_x, origin.scale_y);
        this._openingMainScreen = true;
        screen.opacity = 0;
        // Let Shell allocate the hidden card at its origin before making it visible.
        const startAnimation = () => {
            screen.disconnect(this._openAnimationAllocationId);
            this._openAnimationAllocationId = 0;
            this._openAnimationLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._openAnimationLaterId = 0;
                if (this._main_screen !== screen || this._closingMainScreen)
                    return GLib.SOURCE_REMOVE;
                this._animateMainScreen(screen, { x, y, scale_x: 1, scale_y: 1, opacity: 255 }, true, () => {
                    this._openingMainScreen = false;
                });
                return GLib.SOURCE_REMOVE;
            });
        };
        this._openAnimationAllocationId = screen.connect('notify::allocation', startAnimation);
        screen.show();
        if (this._openAnimationAllocationId && screen.has_allocation())
            startAnimation();
    }

    _animateMainScreen(screen, target, opening, onComplete) {
        const start = {
            x: screen.x, y: screen.y,
            scale_x: screen.scale_x, scale_y: screen.scale_y, opacity: screen.opacity,
        };
        const apply = (position, width, height, opacity) => {
            screen.set_position(
                start.x + (target.x - start.x) * position,
                start.y + (target.y - start.y) * position);
            screen.set_scale(
                start.scale_x + (target.scale_x - start.scale_x) * width,
                start.scale_y + (target.scale_y - start.scale_y) * height);
            screen.opacity = Math.round(start.opacity + (target.opacity - start.opacity) * opacity);
        };
        const settings = St.Settings.get();
        if (!settings.enable_animations) {
            apply(1, 1, 1, 1);
            onComplete();
            return;
        }
        const duration = Math.max(1, Math.round((opening ? 620 : 380) * settings.slow_down_factor));
        const timeline = Clutter.Timeline.new_for_actor(screen, duration);
        this._mainScreenTimeline = timeline;
        // Continuous damped springs start at rest and retain velocity through each bounce.
        const spring = (t, damping, frequency) =>
            1 - Math.exp(-damping * t) *
                (Math.cos(frequency * t) + damping / frequency * Math.sin(frequency * t));
        timeline.connect('new-frame', (_timeline, elapsed) => {
            const t = Math.min(1, elapsed / duration);
            if (opening) {
                const fade = Math.min(1, t / 0.35);
                apply(spring(t, 10, 10), spring(t, 10, 12), spring(t, 10, 10),
                    1 - (1 - fade) ** 3);
            } else {
                const position = t * t * (3 - 2 * t);
                const height = Math.min(1, t * 1.12);
                // Collapse vertically a little sooner, then tuck the pill into the panel.
                apply(position, position, height * height * (3 - 2 * height), t ** 3);
            }
        });
        timeline.connect('completed', () => {
            this._mainScreenTimeline = null;
            apply(1, 1, 1, 1);
            onComplete();
        });
        timeline.start();
    }

    _switchPage(showProcesses) {
        if (!this._processPage || this._closingMainScreen || this._showingProcesses === showProcesses)
            return;
        this._showingProcesses = showProcesses;
        const incoming = showProcesses ? this._processPage.actor : this._statusPage;
        const outgoing = showProcesses ? this._statusPage : this._processPage.actor;
        const direction = showProcesses ? 1 : -1;
        incoming.remove_all_transitions();
        outgoing.remove_all_transitions();
        if (!this._useAnimation) {
            this._pageSwitchInProgress = false;
            this._statusPage.visible = !showProcesses;
            this._processPage.setVisible(showProcesses);
            for (const page of [incoming, outgoing]) {
                page.opacity = 255;
                page.translation_x = 0;
            }
            this._styleTabButtons();
            return;
        }
        this._pageSwitchInProgress = true;
        if (!incoming.visible) {
            incoming.opacity = 0;
            incoming.translation_x = direction * 24;
        }
        if (showProcesses)
            this._processPage.setVisible(true, false);
        else
            incoming.show();
        this._pageStack.set_child_above_sibling(incoming, null);
        const screen = this._main_screen;
        outgoing.ease({ opacity: 0, translation_x: -direction * 24,
            duration: 280, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._main_screen !== screen || this._closingMainScreen || this._showingProcesses !== showProcesses)
                    return;
                if (showProcesses)
                    outgoing.hide();
                else
                    this._processPage?.setVisible(false, false);
                outgoing.translation_x = 0;
            },
        });
        incoming.ease({ opacity: 255, translation_x: 0,
            duration: 280, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._main_screen !== screen || this._closingMainScreen || this._showingProcesses !== showProcesses)
                    return;
                this._pageSwitchInProgress = false;
                if (showProcesses)
                    this._processPage?.refresh();
            },
        });
        this._styleTabButtons();
    }

    _stylePageButtons() {
        const colors = this._updateThemeColors();
        this._tabStrip.set_style(`padding: 5px; spacing: 4px; background-color: ${colors.background}; border-radius: 23px;`);
        this._headerButtons.set_style(`padding: 5px; spacing: 8px; background-color: ${colors.background}; border-radius: 23px;`);
        this._pageContainer.set_style(`background-color: ${colors.background}; border: 1px solid ${colors.accent}; border-radius: 28px; box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);`);
        this._tabHighlight.set_style(`background-color: ${colors.isDark ? '#636366' : colors.surface}; border-radius: 18px;`);
        this._styleTabButtons();
        this._processPage.setTheme(colors);
    }

    _styleTabButtons() {
        const colors = this._updateThemeColors();
        const showProcesses = this._showingProcesses;
        for (const [button, active] of [[this._statusButton, !showProcesses], [this._processButton, showProcesses]])
            button.set_style(`padding: 8px 16px; border-radius: 18px; font-size: 12px; font-weight: 600; background-color: transparent; color: ${active ? colors.text : colors.secondaryText};`);
        this._queueTabHighlight(this._useAnimation);
    }

    _queueTabHighlight(animate) {
        if (!this._processPage || this._closingMainScreen)
            return;
        if (this._tabHighlightLaterId)
            return;
        this._tabHighlightLaterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._tabHighlightLaterId = 0;
            this._moveTabHighlight(animate);
            return GLib.SOURCE_REMOVE;
        });
    }

    _moveTabHighlight(animate = this._useAnimation) {
        if (!this._processPage || this._closingMainScreen)
            return;
        const button = this._showingProcesses ? this._processButton : this._statusButton;
        if (!button.has_allocation())
            return;
        const [x, y] = button.get_position();
        const [width, height] = button.get_size();
        const [baseWidth, baseHeight] = this._statusButton.get_size();
        if (baseWidth <= 0 || baseHeight <= 0)
            return;
        const [highlightWidth, highlightHeight] = this._tabHighlight.get_size();
        if (highlightWidth !== baseWidth || highlightHeight !== baseHeight)
            this._tabHighlight.set_size(baseWidth, baseHeight);
        const target = {
            translation_x: x, translation_y: y,
            scale_x: width / baseWidth, scale_y: height / baseHeight,
        };
        if (this._tabHighlightTarget && Object.keys(target).every(key =>
            this._tabHighlightTarget[key] === target[key]))
            return;
        const initialized = this._tabHighlightTarget !== null;
        this._tabHighlightTarget = target;
        if (animate && initialized) {
            this._tabSwitchInProgress = true;
            this._tabHighlight.ease({
                ...target, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this._tabSwitchInProgress = false;
                    if (!this._pageSwitchInProgress && this._showingProcesses)
                        this._processPage?.refresh();
                },
            });
        } else {
            this._tabSwitchInProgress = false;
            this._tabHighlight.remove_all_transitions();
            this._tabHighlight.set_scale(target.scale_x, target.scale_y);
            this._tabHighlight.translation_x = x;
            this._tabHighlight.translation_y = y;
        }
    }

    _setIndicatorTextVisible(visible, animate = this._useAnimation) {
        if (!this._label)
            return;
        if (!visible) {
            this._labelTimeoutIds.forEach(id => GLib.source_remove(id));
            this._labelTimeoutIds = [];
        } else {
            this._label.text = 'Info';
        }
        this._label.remove_all_transitions();
        this._label.set_pivot_point(0.5, 0.5);
        const target = {
            opacity: visible ? 255 : 0,
            scale_x: visible ? 1 : 0.6,
            scale_y: visible ? 1 : 0.6,
            translation_y: visible ? 0 : -4,
        };
        if (animate) {
            this._label.ease({
                ...target, duration: visible ? 240 : 180,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        } else {
            this._label.opacity = target.opacity;
            this._label.set_scale(target.scale_x, target.scale_y);
            this._label.translation_y = target.translation_y;
        }
    }

    async _createLeftColumn(column, popupHeight) {
        const sections = [
            { height: Math.floor(popupHeight * 0.04), type: 'space' },
            { height: Math.floor(popupHeight * 0.18), type: 'device' },
            { height: Math.floor(popupHeight * 0.04), type: 'space' },
            { height: Math.floor(popupHeight * 0.12), type: 'network' },
            { height: Math.floor(popupHeight * 0.025), type: 'space' },
            { height: Math.floor(popupHeight * 0.12), type: 'memory' },
            { height: Math.floor(popupHeight * 0.025), type: 'space' },
            { height: Math.floor(popupHeight * 0.24), type: 'storage' },
            { height: Math.floor(popupHeight * 0.005), type: 'space' },
            { height: Math.floor(popupHeight * 0.1), type: 'power' }
        ];

        // create shells synchronously, populate sections in parallel
        const tasks = [];
        for (const section of sections) {
            const sectionColumn = this._createColumn(null, section.height);
            if (section.type !== 'space')
                sectionColumn.style = 'padding: 3px 0;';
            if (section.type === 'power') {
                this._powerSection = sectionColumn;
                sectionColumn.visible = this._showPowerSection;
            }
            column.add_child(sectionColumn);
            switch (section.type) {
                case 'device':
                    tasks.push(this._createDeviceSection(sectionColumn));
                    break;
                case 'network':
                    tasks.push(this._createNetworkSection(sectionColumn));
                    break;
                case 'memory':
                    tasks.push(this._createMemorySection(sectionColumn));
                    break;
                case 'storage':
                    tasks.push(this._createStorageSection(sectionColumn));
                    break;
                case 'power':
                    tasks.push(this._createPowerSection(sectionColumn));
                    break;
            }
        }
        await Promise.allSettled(tasks);
    }

    async _createRightColumn(column, popupHeight) {
        const sections = [
            { height: Math.floor(popupHeight * 0.11), type: 'space' },
            { height: Math.floor(popupHeight * 0.10), type: 'os' },
            { height: Math.floor(popupHeight * 0.04), type: 'space' },
            { height: Math.floor(popupHeight * 0.38), type: 'cpu' },
            { height: Math.floor(popupHeight * 0.02), type: 'space' },
            { height: Math.floor(popupHeight * 0.30), type: 'gpu' }
        ];

        // create shells synchronously, populate sections in parallel
        const tasks = [];
        for (const section of sections) {
            const sectionColumn = this._createColumn(null, section.height);
            if (section.type !== 'space')
                sectionColumn.style = 'padding: 3px 0;';
            column.add_child(sectionColumn);
            switch (section.type) {
                case 'os':
                    tasks.push(this._createOSSection(sectionColumn));
                    break;
                case 'cpu':
                    tasks.push(this._createCPUSection(sectionColumn));
                    break;
                case 'gpu':
                    tasks.push(this._createGPUSection(sectionColumn));
                    break;
            }
        }
        await Promise.allSettled(tasks);
    }

    _createHeaderButtons(navigation) {
        const buttonsRow = new St.BoxLayout({
            ...horizontalBox,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.FILL,
            style: 'spacing: 6px;'
        });

        const buttonConfigs = [
            {
                key: 'close',
                label: '×',
                bg: '#ff453a',
                onClick: () => {
                    this._indicator.remove_style_class_name('active');
                    this.destroyMainScreen();
                }
            }
        ];

        if (this._showCopyButton) {
            buttonConfigs.unshift({
                key: 'copy',
                iconPath: `${this._extension.path}/assets/copy-symbolic.svg`,
                bg: '#0a84ff',
                onClick: () => {
                    this._copySystemInfoToClipboard().catch((error) => {
                        logError(error, 'System HUD: Error copying info');
                    });
                }
            });
        }

        for (const cfg of buttonConfigs) {
            const button = new St.Button({
                style: `background-color: ${cfg.bg};
                        color: white;
                        width: 34px; 
                        border-radius: 18px;
                        border: 1px solid rgba(255, 255, 255, 0.24);
                        font-weight: bold;
                        font-size: 18px;`,
            });
            if (cfg.iconPath) {
                button.set_child(new St.Icon({
                    gicon: Gio.icon_new_for_string(cfg.iconPath),
                    icon_size: 16,
                }));
            } else {
                button.label = cfg.label;
            }
            addButtonAnimation(button, () => this._useAnimation);
            button.connect('clicked', cfg.onClick);

            if (cfg.key === 'copy')
                this._copyButton = button;
            else if (cfg.key === 'close')
                this._closeButton = button;

            buttonsRow.add_child(button);
        }
        this._headerButtons = buttonsRow;
        navigation.add_child(buttonsRow);
    }

    async _copySystemInfoToClipboard() {
        const screen = this._main_screen;
        const info = await this._systemLink.getAllInfo();
        if (!screen || this._main_screen !== screen || this._closingMainScreen || !info || info.error) {
            return;
        }

        const memory = info.memory || {};
        const network = info.network || {};
        const system = info.system || {};
        const cpu = info.cpu || {};
        const power = info.power || 'Unknown';
        const storage = typeof info.storage === 'string' ? info.storage : '';
        const coreDetails = Array.isArray(cpu.coreDetails) ? cpu.coreDetails : [];
        const cpuLoads = coreDetails.map(core => Number(core.load)).filter(Number.isFinite);
        const cpuTemps = coreDetails.map(core => Number.parseFloat(core.temp)).filter(Number.isFinite);
        const averageLoad = cpuLoads.length
            ? `${(cpuLoads.reduce((sum, value) => sum + value, 0) / cpuLoads.length).toFixed(1)}%`
            : 'N/A';
        const averageTemp = cpuTemps.length
            ? `${(cpuTemps.reduce((sum, value) => sum + value, 0) / cpuTemps.length).toFixed(1)} °C`
            : 'N/A';
        const peakTemp = cpuTemps.length ? `${Math.max(...cpuTemps)} °C` : 'N/A';
        const storageLines = storage
            ? storage.split('\n').filter(line => line.trim().length > 0).map(line => `  ${line}`)
            : ['  N/A'];
        const gpuText = typeof info.gpu === 'string' && info.gpu.trim()
            ? info.gpu.split('\n').map(line => `  ${line}`).join('\n')
            : '  N/A';
        const networkSpeed = network.networkSpeed || 'N/A';

        const text = [
            'SYSTEM',
            `Hostname and uptime: ${info.uptime || 'Unknown'}`,
            `OS: ${system.osName || 'Unknown'}`,
            `Architecture: ${system.osType || 'Unknown'}`,
            `Kernel: ${system.kernelVersion || 'Unknown'}`,
            `GNOME Shell: ${system.gnomeVersion || 'Unknown'}`,
            `Session: ${system.sessionType || 'Unknown'}`,
            '',
            'CPU',
            `Model: ${cpu.cpu || 'Unknown'}`,
            `Logical cores: ${cpu.core ?? 'N/A'}`,
            `Average per-core load: ${averageLoad}`,
            `Temperature source: ${cpu.temperatureSource === 'igpu' ? 'iGPU estimate shared across cores, not measured CPU temperatures' : 'CPU sensors'}`,
            `Average displayed temperature: ${averageTemp}`,
            `Highest displayed temperature: ${peakTemp}`,
            'Per-core measurements (frequency, load, temperature):',
            ...(coreDetails.length > 0
                ? coreDetails.map(core => `  ${core.name || `Core ${core.index}`} | ${core.speed ?? 'N/A'} MHz | ${core.load ?? 'N/A'}% | ${core.temp ?? 'N/A'} °C`)
                : ['  N/A']),
            '',
            'GPU',
            gpuText,
            '',
            'MEMORY',
            `RAM used / total: ${memory.use || 'N/A'} GB / ${memory.max || 'N/A'} (${memory.percent || 'N/A'})`,
            `Memory cache: ${memory.cache || 'N/A'}`,
            `Swap used / total: ${memory.swapUse || 'N/A'} GB / ${memory.swapMax || 'N/A'} (${memory.swapPercent || 'N/A'})`,
            '',
            'STORAGE',
            ...storageLines,
            '',
            'NETWORK (IP addresses and Wi-Fi name omitted)',
            `Connection: ${network.wifiSSID && !['Unknown', 'Not connected'].includes(network.wifiSSID) ? 'Wi-Fi connected' : 'No Wi-Fi connection'}`,
            `Measured network speed: ${networkSpeed}`,
            '',
            'POWER',
            String(power || 'Unknown').split('\n').map(line => `  ${line}`).join('\n')
        ].join('\n');

        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);

        if (this._copyButton) {
            this._copyButton.set_child(new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 16,
            }));
            if (this._copyButtonTimeoutId)
                GLib.source_remove(this._copyButtonTimeoutId);
            this._copyButtonTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._copyButtonTimeoutId = null;
                if (this._copyButton)
                    this._copyButton.set_child(new St.Icon({
                        gicon: Gio.icon_new_for_string(`${this._extension.path}/assets/copy-symbolic.svg`),
                        icon_size: 16,
                    }));
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    async _createDeviceSection(column) {
        const themeColors = this._updateThemeColors();
        const userName = GLib.get_user_name();
        this._profileImagePath = `/var/lib/AccountsService/icons/${userName}`;
        const avatarSize = Math.floor(column.height * 0.9);

        const profileRow = new St.BoxLayout({
            ...horizontalBox,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        this._profileBin = new St.Bin({
            width: avatarSize,
            height: avatarSize,
            style: `
                background-image: url("file://${this._profileImagePath}");
                background-size: cover;
                background-position: center;
                border-radius: 360px;
                border: 2px solid ${themeColors.accent};
            `,
            clip_to_allocation: true,
        });

        profileRow.add_child(this._profileBin);

        const deviceInfoUser = new St.BoxLayout({
            ...verticalBox,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            style: 'padding-left: 15px;',
        });

        this._deviceLabel = new St.Label({
            text: `Device name`,
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 14px;`,
        });

        const deviceNameRow = new St.BoxLayout({
            ...horizontalBox,
            x_align: Clutter.ActorAlign.START,
        });

        this._deviceWithUptime = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 600; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });

        deviceNameRow.add_child(this._deviceWithUptime);

        deviceInfoUser.add_child(this._deviceLabel);
        deviceInfoUser.add_child(deviceNameRow);

        profileRow.add_child(deviceInfoUser);
        column.add_child(profileRow);
        this._queueSectionRefresh('device', 0);
    }

    async _createNetworkSection(column) {
        const themeColors = this._updateThemeColors();
        const ipAndWiFi_LeftColumn = this._createColumn(null, null);
        this._wifiLabel = new St.Label({
            text: 'Wi-Fi : ',
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`
        });
        this._wifiSpeedLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 600; font-size: 13px;`
        });
        const wifiRow = new St.BoxLayout({ ...horizontalBox });
        wifiRow.add_child(this._withSectionIcon(this._wifiLabel, 'network-wireless-symbolic'));
        wifiRow.add_child(this._wifiSpeedLabel);
        ipAndWiFi_LeftColumn.add_child(wifiRow);
        const publicipRow = new St.BoxLayout({ ...horizontalBox });
        const localipRow = new St.BoxLayout({ ...horizontalBox });
        this._publicIPDescLabel = new St.Label({
            text: 'Public IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: 500; font-size: 12px;`
        });
        this._publicIPLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 12px;`
        });
        publicipRow.add_child(this._publicIPDescLabel);
        publicipRow.add_child(this._publicIPLabel);
        this._localIPDescLabel = new St.Label({
            text: 'Local IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: 500; font-size: 12px;`
        });
        this._localIPLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 12px;`
        });
        localipRow.add_child(this._localIPDescLabel);
        localipRow.add_child(this._localIPLabel);
        ipAndWiFi_LeftColumn.add_child(publicipRow);
        ipAndWiFi_LeftColumn.add_child(localipRow);
        column.add_child(ipAndWiFi_LeftColumn);
        this._queueSectionRefresh('network', 0);
    }

    async _createMemorySection(column) {
        const themeColors = this._updateThemeColors();
        this._memoryHead = new St.Label({
            text: 'Memory',
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`
        });
        this._memoryBox = new St.BoxLayout({
            ...verticalBox,
            x_expand: true,
            y_expand: false
        });
        this._memoryBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 11px;`,
            x_expand: true
        }));
        column.add_child(this._withSectionIcon(this._memoryHead, 'memory-symbolic'));
        column.add_child(this._memoryBox);
        this._queueSectionRefresh('memory', 0);
    }

    async _createStorageSection(column) {
        const themeColors = this._updateThemeColors();
        this._storageHead = new St.Label({
            text: 'Storage',
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`
        });
        this._storageBox = new St.BoxLayout({
            ...verticalBox,
            x_expand: true,
            y_expand: true
        });
        const storage_scrollView = new St.ScrollView({
            style_class: 'custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });
        storage_scrollView.set_child(this._storageBox);
        this._storageBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 11px;`,
            x_expand: true
        }));
        column.add_child(this._withSectionIcon(this._storageHead, 'drive-harddisk-symbolic'));
        column.add_child(storage_scrollView);
        this._queueSectionRefresh('storage', 0);
    }

    async _createPowerSection(column) {
        const themeColors = this._updateThemeColors();
        this._powerHead = new St.Label({
            text: 'Power',
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`
        });
        this._powerBox = new St.BoxLayout({
            ...verticalBox,
            x_expand: true,
            y_expand: false
        });
        const loadingLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 11px;`,
            x_expand: true
        });
        this._powerShow = null;
        this._powerBox.add_child(loadingLabel);
        column.add_child(this._withSectionIcon(this._powerHead, 'battery-good-symbolic'));
        column.add_child(this._powerBox);
        this._queueSectionRefresh('power', 0);
    }

    async _createOSSection(column) {
        const themeColors = this._updateThemeColors();
        const osStyle = `color: ${themeColors.text}; font-weight: 600; font-size: 18px;`;
        const osRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 6px;' });
        this._osPrefix = new St.Label({ text: 'OS :', style: osStyle });
        osRow.add_child(this._osPrefix);
        const viewport = new St.Widget({
            layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true,
            x_expand: true, min_width: 0, natural_width: 0,
        });
        this._device_OS = new St.Label({
            text: 'Loading...',
            style: osStyle,
            x_align: Clutter.ActorAlign.START,
        });
        this._device_OS.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._device_OS.clutter_text.single_line_mode = true;
        viewport.add_child(this._device_OS);
        osRow.add_child(viewport);

        const label = this._device_OS;
        let timer = 0;
        const stop = () => {
            if (timer) {
                GLib.source_remove(timer);
                timer = 0;
            }
            label.remove_all_transitions();
            label.translation_x = 0;
        };
        const restart = () => {
            stop();
            if (!viewport.mapped || !this._useAnimation || this._closingMainScreen)
                return;
            const overflow = label.get_preferred_width(-1)[1] - viewport.width;
            if (overflow <= 0)
                return;
            const slide = toEnd => {
                timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                    timer = 0;
                    if (!viewport.mapped || !this._useAnimation || this._closingMainScreen)
                        return GLib.SOURCE_REMOVE;
                    label.ease({ translation_x: toEnd ? -overflow : 0,
                        duration: Math.max(1000, Math.round(overflow / 30 * 1000)),
                        mode: Clutter.AnimationMode.LINEAR,
                        onComplete: () => slide(!toEnd),
                    });
                    return GLib.SOURCE_REMOVE;
                });
            };
            slide(true);
        };
        this._updateOSMarquee = restart;
        viewport.connect('notify::allocation', restart);
        viewport.connect('notify::mapped', restart);
        label.connect('notify::allocation', restart);
        label.connect('notify::text', restart);
        label.connect('style-changed', restart);
        viewport.connect('destroy', () => {
            stop();
            if (this._updateOSMarquee === restart)
                this._updateOSMarquee = null;
        });

        this._device_Kernel = new St.Label({
            text: 'Kernel : Loading...',
            style: `color: ${themeColors.text}; font-weight: 600; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });

        column.add_child(osRow);
        column.add_child(this._device_Kernel);

        const setPrimary = () => {
            if (this._osDetails) {
                updateOSData({
                    device_OS: this._device_OS,
                    device_Kernel: this._device_Kernel
                }, this._osDetails);
            }
        };

        const setAlternate = () => {
            if (!this._osDetails)
                return;
            this._device_Kernel.text = `GNOME : ${this._osDetails.gnomeVersion} | Session : ${this._osDetails.sessionType}`;
        };

        const connectHover = actor => {
            actor.reactive = true;
            actor.can_focus = true;
            actor.track_hover = true;
            actor.connect('enter-event', () => {
                setAlternate();
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('leave-event', () => {
                setPrimary();
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('touch-event', () => {
                setAlternate();
                if (this._osHoverTimeoutId) {
                    GLib.source_remove(this._osHoverTimeoutId);
                    this._osHoverTimeoutId = null;
                }
                this._osHoverTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    setPrimary();
                    this._osHoverTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
                return Clutter.EVENT_STOP;
            });
        };

        connectHover(osRow);
        connectHover(this._device_Kernel);

        this._queueSectionRefresh('os', 0);
    }

    async _createCPUSection(column) {
        const themeColors = this._updateThemeColors();
        this._cpuHead = new St.Label({
            text: 'Processor',
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`
        });
        this._cpuName = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 600; font-size: 14px;`
        });
        this._coreBox = new St.BoxLayout({
            ...verticalBox,
            x_expand: true,
            y_expand: true
        });
        const cpu_scrollView = new St.ScrollView({
            style_class: 'custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });
        cpu_scrollView.set_child(this._coreBox);

        this._coreBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 11px;`,
            x_expand: true
        }));

        const cpuHeadBox = new St.BoxLayout({ ...verticalBox });
        cpuHeadBox.add_child(this._withSectionIcon(this._cpuHead, 'cpu-symbolic'));
        cpuHeadBox.add_child(this._cpuName);
        column.add_child(cpuHeadBox);
        // Keep refreshed scroll contents within the CPU section's height budget.
        cpu_scrollView.set_height(Math.max(1, column.height - cpuHeadBox.get_preferred_height(-1)[1] - 6));
        cpu_scrollView.y_expand = false;
        column.add_child(cpu_scrollView);
        this._queueSectionRefresh('cpu', 0);
    }

    async _createGPUSection(column) {
        const themeColors = this._updateThemeColors();
        this._gpuHead = new St.Label({
            text: 'Graphics',
            style: `color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`
        });
        this._gpuBox = new St.BoxLayout({
            ...verticalBox,
            x_expand: true,
            y_expand: true,
            style: 'padding: 2px 0;'
        });
        const gpu_scrollView = new St.ScrollView({
            style_class: 'custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true,
        });
        gpu_scrollView.set_child(this._gpuBox);
        column.add_child(this._withSectionIcon(this._gpuHead, 'video-display-symbolic'));
        column.add_child(gpu_scrollView);
        this._gpuBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: 500; font-size: 11px;`,
            x_expand: true
        }));
        this._queueSectionRefresh('gpu', 0);
    }

    async _updateGPUInfo(cachedInfo) {
        const screen = this._main_screen;
        if (this._gpuBox) {
            const themeColors = this._updateThemeColors();
            const gpuInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getGPUInfo();
            this._displayCache.gpu = gpuInfo;
            if (!screen || this._main_screen !== screen || this._closingMainScreen)
                return;
            const entries = (gpuInfo ?? '').split(/\n\s*\n/).filter(entry => entry.trim());
            if (cachedInfo === undefined) {
                for (const entry of entries) {
                    const identity = entry.match(/^Device:\s*(.+)$/m)?.[1] ?? entry.split('\n')[0];
                    const history = this._gpuHistories.get(identity) ?? { memory: [], temperature: [], load: [] };
                    const matches = {
                        memory: entry.match(/(?:Memory Usage|VRAM):\s*[\d.]+\s*MB\s*\/\s*[\d.]+\s*(?:GB|MB)\s*\|\s*([\d.]+)%/),
                        temperature: entry.match(/Temp:\s*([\d.]+)\s*°C/),
                        load: entry.match(/GPU Utilization:\s*([\d.]+)%/),
                    };
                    for (const [metric, match] of Object.entries(matches)) {
                        if (match) {
                            history[metric].push(Number.parseFloat(match[1]));
                            if (history[metric].length > 60)
                                history[metric].shift();
                        }
                    }
                    this._gpuHistories.set(identity, history);
                }
                for (const identity of this._gpuHistories.keys()) {
                    if (!entries.some(entry => (entry.match(/^Device:\s*(.+)$/m)?.[1] ?? entry.split('\n')[0]) === identity))
                        this._gpuHistories.delete(identity);
                }
            }
            updateGPUData({
                gpuBox: this._gpuBox,
                gpuHead: this._gpuHead,
                gpuHistories: entries.map(entry => this._gpuHistories.get(entry.match(/^Device:\s*(.+)$/m)?.[1] ?? entry.split('\n')[0])),
                showGraph: this._showGpuGraph,
                sampleInterval: this._refreshIntervalMs * this._refreshMultipliers.gpu,
                animationsEnabled: this._useAnimation,
            }, gpuInfo, themeColors, St);
        }
    }

    async _updateDeviceInfo(cachedInfo) {
        const screen = this._main_screen;
        if (this._deviceWithUptime) {
            const uptime = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getUptime();
            this._displayCache.device = uptime;
            if (!screen || this._main_screen !== screen || this._closingMainScreen)
                return;
            updateDeviceData({ deviceWithUptime: this._deviceWithUptime }, uptime);
        }
    }

    async _updateNetworkInfo(cachedInfo) {
        const screen = this._main_screen;
        const networkInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getNetworkInfo();
        this._displayCache.network = networkInfo;
        if (!screen || this._main_screen !== screen || this._closingMainScreen)
            return;
        updateNetworkData({
            wifiSpeedLabel: this._wifiSpeedLabel,
            publicIPLabel: this._publicIPLabel,
            localIPLabel: this._localIPLabel
        }, networkInfo);
    }

    async _updateMemoryInfo(cachedInfo) {
        const screen = this._main_screen;
        if (this._memoryBox || (this._memoryUse && this._memoryCache)) {
            try {
                const memoryInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getMemoryInfo();
                this._displayCache.memory = memoryInfo;
                if (!screen || this._main_screen !== screen || this._closingMainScreen)
                    return;
                const themeColors = this._updateThemeColors();
                updateMemoryData({
                    memoryBox: this._memoryBox,
                    memoryUse: this._memoryUse,
                    memorySwap: this._memorySwap,
                    memoryCache: this._memoryCache
                }, memoryInfo, themeColors, St);
            } catch (error) {
                logError(error, 'System HUD: Error updating memory info');
                if (!screen || this._main_screen !== screen || this._closingMainScreen)
                    return;
                const themeColors = this._updateThemeColors();
                updateMemoryData({
                    memoryBox: this._memoryBox,
                    memoryUse: this._memoryUse,
                    memorySwap: this._memorySwap,
                    memoryCache: this._memoryCache
                }, null, themeColors, St);
            }
        }
    }

    async _updateOSInfo(cachedInfo) {
        const screen = this._main_screen;
        if (!this._device_OS || !this._device_Kernel)
            return;

        try {
            const systemInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getSystemInfo();
            this._displayCache.os = systemInfo;
            if (!screen || this._main_screen !== screen || this._closingMainScreen)
                return;
            this._osDetails = systemInfo;
            updateOSData({
                device_OS: this._device_OS,
                device_Kernel: this._device_Kernel
            }, systemInfo);
        } catch (error) {
            logError(error, 'System HUD: Error updating system info');
            if (!screen || this._main_screen !== screen || this._closingMainScreen)
                return;
            this._osDetails = null;
            this._device_OS.text = 'Unknown';
            this._device_Kernel.text = 'Kernel : Unknown';
        }
    }

    async _updateStorageInfo(cachedInfo) {
        const screen = this._main_screen;
        if (this._storageBox) {
            const storageInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getStorageInfo();
            this._displayCache.storage = storageInfo;
            if (!screen || this._main_screen !== screen || this._closingMainScreen)
                return;
            const themeColors = this._updateThemeColors();
            updateStorageData({ storageBox: this._storageBox }, storageInfo, themeColors, St);
        }
    }

    async _updatePowerInfo(cachedInfo) {
        const screen = this._main_screen;
        if (this._powerShow || this._powerBox) {
            try {
                const powerInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getPowerInfo();
                this._displayCache.power = powerInfo;
                if (!screen || this._main_screen !== screen || this._closingMainScreen)
                    return;
                const themeColors = this._updateThemeColors();
                updatePowerData({
                    powerBox: this._powerBox,
                    powerShow: this._powerShow
                }, powerInfo, themeColors, St);
            } catch (error) {
                logError(error, 'System HUD: Error updating power info');
                if (!screen || this._main_screen !== screen || this._closingMainScreen)
                    return;
                const themeColors = this._updateThemeColors();
                updatePowerData({
                    powerBox: this._powerBox,
                    powerShow: this._powerShow
                }, null, themeColors, St);
            }
        }
    }

    async _updateCPUInfo(cachedInfo) {
        const screen = this._main_screen;
        if (this._coreBox) {
            const cpuInfo = cachedInfo !== undefined ? cachedInfo : await this._systemLink.getCPUInfo();
            this._displayCache.cpu = cpuInfo;
            if (!screen || this._main_screen !== screen || this._closingMainScreen)
                return;
            if (cachedInfo === undefined && cpuInfo === this._lastCPUInfo)
                return;

            if (!Array.isArray(cpuInfo.coreDetails))
                return;

            if (cachedInfo === undefined) {
                this._cpuLoadHistory.push(cpuInfo.coreDetails.map(core =>
                    Number.isFinite(core.load) ? core.load : 0
                ));
                if (this._cpuLoadHistory.length > 60)
                    this._cpuLoadHistory.shift();
                this._cpuTemperatureHistory.push(cpuInfo.coreDetails.map(core => {
                    const temperature = Number.parseFloat(core.temp);
                    return Number.isFinite(temperature) ? temperature : null;
                }));
                if (this._cpuTemperatureHistory.length > 60)
                    this._cpuTemperatureHistory.shift();
            }
            this._lastCPUInfo = cpuInfo;
            const themeColors = this._updateThemeColors();
            updateCPUData({ cpuName: this._cpuName, coreBox: this._coreBox, showGraph: this._showCpuGraph, cpuCoreColors: this._cpuCoreColors,
                sampleInterval: this._refreshIntervalMs * this._refreshMultipliers.cpu, animationsEnabled: this._useAnimation }, {
                ...cpuInfo,
                loadHistory: this._cpuLoadHistory,
                temperatureHistory: this._cpuTemperatureHistory
            }, themeColors, St);
        }
    }

    async _updateAllInfo() {
        if (!this._main_screen || this._openingMainScreen || this._closingMainScreen ||
            this._tabSwitchInProgress || this._pageSwitchInProgress || this._tabHighlightLaterId) return;
        if (this._showingProcesses && this._processPage) {
            await this._processPage.refresh();
            return;
        }
        const now = Date.now();
        const sections = ['device', 'network', 'memory', 'os', 'storage', 'power', 'cpu', 'gpu'];
        const tasks = [];

        for (const section of sections) {
            if (!this._shouldRefreshSection(section, now))
                continue;

            this._markSectionRefreshed(section, now);
            tasks.push(this._runSectionUpdate(section));
        }

        if (tasks.length > 0)
            await Promise.allSettled(tasks);
    }



    destroyMainScreen(animate = this._useAnimation) {
        if (this._closingMainScreen && animate)
            return;
        this._openingMainScreen = false;
        if (this._mainScreenTimeline) {
            this._mainScreenTimeline.stop();
            this._mainScreenTimeline = null;
        }
        this._tabSwitchInProgress = false;
        this._pageSwitchInProgress = false;
        if (this._openAnimationAllocationId && this._main_screen) {
            this._main_screen.disconnect(this._openAnimationAllocationId);
            this._openAnimationAllocationId = 0;
        }
        if (this._openAnimationLaterId) {
            global.compositor.get_laters().remove(this._openAnimationLaterId);
            this._openAnimationLaterId = 0;
        }
        if (this._tabHighlightLaterId) {
            global.compositor.get_laters().remove(this._tabHighlightLaterId);
            this._tabHighlightLaterId = 0;
        }
        for (const property of ['_osHoverTimeoutId', '_copyButtonTimeoutId']) {
            if (this[property]) {
                GLib.source_remove(this[property]);
                this[property] = null;
            }
        }
        if (this._processPage) {
            this._processSnapshot = this._processPage.getSnapshot();
            this._processPage.destroy();
            this._processPage = null;
        }
        if (this._main_screen) {
            if (this._mainScreenKeyPressId) {
                this._main_screen.disconnect(this._mainScreenKeyPressId);
                this._mainScreenKeyPressId = null;
            }
            const screen = this._main_screen;
            this._closingMainScreen = true;
            screen.remove_all_transitions();
            const finish = () => {
                Main.layoutManager.removeChrome(screen);
                screen.destroy();
                if (this._main_screen === screen) {
                    this._main_screen = null;
                    this._closingMainScreen = false;
                    this._setIndicatorTextVisible(true, animate);
                }
            };
            if (animate && screen.mapped && screen.opacity > 0) {
                const target = this._getIndicatorAnimationTarget(screen);
                screen.set_pivot_point(0.5, 0.5);
                this._animateMainScreen(screen, { ...target, opacity: 0 }, false, finish);
            } else {
                finish();
            }
        }

        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = null;
        }

        if (this._sectionRefreshTimeoutIds) {
            this._sectionRefreshTimeoutIds.forEach(id => GLib.source_remove(id));
            this._sectionRefreshTimeoutIds = [];
        }

        this._nextRefreshAt = {};
    }

    destroy() {
        this.destroyMainScreen(false);

        if (this._settings) {
            for (const id of this._settingsSignalIds) {
                this._settings.disconnect(id);
            }
            this._settingsSignalIds = [];
            this._settings = null;
        }
        
        if (this._themeManager) {
            this._themeManager.disconnectThemeChanged(this._themeChangeSignal);
            this._themeManager = null;
        }
        
        if (this._indicator) {
            if (this._indicatorClickSignalId) {
                this._indicator.disconnect(this._indicatorClickSignalId);
                this._indicatorClickSignalId = null;
            }
            if (this._indicatorTouchSignalId) {
                this._indicator.disconnect(this._indicatorTouchSignalId);
                this._indicatorTouchSignalId = null;
            }
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._labelTimeoutIds) {
            this._labelTimeoutIds.forEach(id => GLib.source_remove(id));
            this._labelTimeoutIds = [];
        }

        if (this._sectionRefreshTimeoutIds) {
            this._sectionRefreshTimeoutIds.forEach(id => GLib.source_remove(id));
            this._sectionRefreshTimeoutIds = [];
        }

        if (this._osHoverTimeoutId) {
            GLib.source_remove(this._osHoverTimeoutId);
            this._osHoverTimeoutId = null;
        }

        if (this._copyButtonTimeoutId) {
            GLib.source_remove(this._copyButtonTimeoutId);
            this._copyButtonTimeoutId = null;
        }
        this._systemLink = null;
        this._extension = null;
        this._displayCache = {};
        this._processSnapshot = [];
        this._gpuHistories.clear();
    }
}
