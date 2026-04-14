import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
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
        this._updateTimeoutId = null;
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
        this._osDetails = null;
        this._osHoverTimeoutId = null;
        this._themeManager = new ThemeManager();
        this._themeChangeSignal = this._themeManager.connectThemeChanged(
            this._onThemeChanged.bind(this)
        );
        this._settings = null;
        this._settingsSignalIds = [];
        this._useAnimation = true; // Default: use animation
        this._showCopyButton = true; // Default: show copy button
        this._labelTimeoutIds = []; // Track label animation timeouts
        this._updateInProgress = false; // prevent overlapping updates
        this._mainScreenKeyPressId = null;
        this._applyRefreshInterval(this._refreshIntervalMs);

        try {
            this._settings = this._extension.getSettings();
            this._useAnimation = this._settings.get_boolean('enable-animations');
            this._showCopyButton = this._settings.get_boolean('show-copy-button');
            this._applyRefreshInterval(this._settings.get_int('refresh-interval-ms'));
            this._settingsSignalIds.push(this._settings.connect('changed::enable-animations', () => {
                this._useAnimation = this._settings.get_boolean('enable-animations');
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::show-copy-button', () => {
                this._showCopyButton = this._settings.get_boolean('show-copy-button');
                if (this._copyButton)
                    this._copyButton.visible = this._showCopyButton;
            }));
            this._settingsSignalIds.push(this._settings.connect('changed::refresh-interval-ms', () => {
                this._applyRefreshInterval(this._settings.get_int('refresh-interval-ms'));
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

        this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._refreshIntervalMs, () => {
            if (this._updateInProgress)
                return GLib.SOURCE_CONTINUE;

            this._updateInProgress = true;
            this._updateAllInfo()
                .catch(e => {
                    try {
                        logError(e, 'System HUD: Error updating HUD');
                    } catch (_) {
                    }
                })
                .finally(() => {
                    this._updateInProgress = false;
                });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _queueSectionRefresh(section, delayMs = 0) {
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

    async _runSectionUpdate(section) {
        switch (section) {
        case 'device':
            await this._updateDeviceInfo();
            break;
        case 'network':
            await this._updateNetworkInfo();
            break;
        case 'memory':
            await this._updateMemoryInfo();
            break;
        case 'os':
            await this._updateOSInfo();
            break;
        case 'storage':
            await this._updateStorageInfo();
            break;
        case 'power':
            await this._updatePowerInfo();
            break;
        case 'cpu':
            await this._updateCPUInfo();
            break;
        case 'gpu':
            await this._updateGPUInfo();
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
                let pauseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5555, () => {
                    let j = welcomeText.length;
                    let eraseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, typingInterval, () => {
                        j--;
                        this._label.text = welcomeText.slice(0, j);
                        if (j === 0) {
                            let k = 1;
                            let infoId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, typingInterval, () => {
                                this._label.text = infoText.slice(0, k);
                                k++;
                                if (k > infoText.length) {
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

        this._indicator.connect('button-press-event', () => {
            if (this._main_screen) {
                this.destroyMainScreen();
            } else {
                this.showMainScreen();
            }
        });

        Main.panel.addToStatusArea(this._extension.uuid, this._indicator);
    }

    _updateThemeColors() {
        return this._themeManager.getThemeColors();
    }

    _onThemeChanged() {
        if (this._main_screen) {
            const themeColors = this._updateThemeColors();
            
            // Update main screen style
            this._main_screen.style = `
                background-color: ${themeColors.background};
                border: 2px solid ${themeColors.accent};
                border-radius: 20px 5px 20px 20px;
            `;

            this._profileBin.style =  `
                background-image: url("file://${this._profileImagePath}");
                background-size: cover;
                background-position: center;
                border-radius: 360px;
                border: 3px solid ${themeColors.accent};
            `;

            if (this._closeButton) {
                this._closeButton.style = `background-color: #f44336;
                    color: white; 
                    width: 35px;
                    height: 35px; 
                    border-radius: 5px; 
                    border: 2px solid ${themeColors.accent};
                    font-weight: bold;`;
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
            updateStorageSectionStyle({
                storageBox: this._storageBox,
                storageHead: this._storageHead
            }, themeColors);
            updatePowerSectionStyle({
                powerShow: this._powerShow,
                powerHead: this._powerHead
            }, themeColors);
            updateOSSectionStyle({
                device_OS: this._device_OS,
                device_Kernel: this._device_Kernel
            }, themeColors);
            updateCPUSectionStyle({
                cpuHead: this._cpuHead,
                cpuName: this._cpuName,
                coreBox: this._coreBox
            }, themeColors, St);
            updateGPUSectionStyle({
                gpuHead: this._gpuHead,
                gpuBox: this._gpuBox
            }, themeColors, St);
            this._updateGPUInfo();
        }
    }

    _createColumn(width, height = null) {
        const themeColors = this._updateThemeColors();
        
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: transparent; border: 0px solid ${themeColors.accent};`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        
        if (width) column.set_width(width);
        if (height) column.set_height(height);
        
        return column;
    }

    _enableDrag(actor) {
        let dragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let actorStartX = 0;
        let actorStartY = 0;

        actor.connect('button-press-event', (actor, event) => {
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
        const themeColors = this._updateThemeColors();
        const monitor = Main.layoutManager.primaryMonitor;
        const popupWidth = Math.floor(monitor.width * 0.4);
        const popupHeight = Math.floor(monitor.height * 0.4);

        this._main_screen = new St.BoxLayout({
            vertical: false,
            style: `
            background-color: ${themeColors.background};
            border: 2px solid ${themeColors.accent};
            border-radius: 20px 5px 20px 20px;
            `,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        // Create columns
        const frontColumn = this._createColumn(Math.floor(popupWidth * 0.05));
        const leftColumn = this._createColumn(Math.floor(popupWidth * 0.44));
        const betweenColumn = this._createColumn(Math.floor(popupWidth * 0.03));
        const rightColumn = this._createColumn(Math.floor(popupWidth * 0.42));
        const bebackColumn = this._createColumn(Math.floor(popupWidth * 0.01));
        const backColumn = this._createColumn(Math.floor(popupWidth * 0.05));

        // Add columns to main screen
        this._main_screen.add_child(frontColumn);
        this._main_screen.add_child(leftColumn);
        this._main_screen.add_child(betweenColumn);
        this._main_screen.add_child(rightColumn);
        this._main_screen.add_child(bebackColumn);
        this._main_screen.add_child(backColumn);

        // Enable dragging on non-button columns to avoid click conflicts.
        this._enableDrag(frontColumn);
        this._enableDrag(leftColumn);
        this._enableDrag(betweenColumn);
        this._enableDrag(rightColumn);
        this._enableDrag(bebackColumn);
        
        // Set size and immediately add to layout so animation can play without waiting for data
        this._main_screen.set_size(popupWidth, popupHeight);
        Main.layoutManager.addChrome(this._main_screen, {
            trackFullscreen: true,
        });

        // Allow Esc to close the popup.
        this._mainScreenKeyPressId = this._main_screen.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._indicator.remove_style_class_name('active');
                this.destroyMainScreen();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._main_screen.grab_key_focus();

        // Compute position and play animation immediately
        const [_, natWidth] = this._main_screen.get_preferred_width(-1);
        const [__, natHeight] = this._main_screen.get_preferred_height(-1);
        const x = Math.floor((monitor.width - natWidth) / 2) + monitor.x;
        const y = Math.floor((monitor.height - natHeight) / 2) + monitor.y;
        if (this._useAnimation) {
            this._main_screen.set_position(x, -natHeight);
            this._main_screen.opacity = 0;
            this._main_screen.ease({
                y: y,
                opacity: 255,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._main_screen.set_position(x, y);
            this._main_screen.opacity = 255;
        }

        // Populate UI components asynchronously so they don't block the entrance animation
        this._createBackColumn(backColumn, popupHeight); // synchronous
        // Start population in background (parallel, not blocking entrance animation)
        this._createLeftColumn(leftColumn, popupHeight).catch((e) => { try { log(e); } catch(_){} });
        this._createRightColumn(rightColumn, popupHeight).catch((e) => { try { log(e); } catch(_){} });

        this._restartUpdateLoop();
    }

    async _createLeftColumn(column, popupHeight) {
        // Create sections
        const sections = [
            { height: Math.floor(popupHeight * 0.06), type: 'space' },
            { height: Math.floor(popupHeight * 0.18), type: 'device' },
            { height: Math.floor(popupHeight * 0.04), type: 'space' },
            { height: Math.floor(popupHeight * 0.12), type: 'network' },
            { height: Math.floor(popupHeight * 0.025), type: 'space' },
            { height: Math.floor(popupHeight * 0.12), type: 'memory' },
            { height: Math.floor(popupHeight * 0.030), type: 'space' },
            { height: Math.floor(popupHeight * 0.24), type: 'storage' },
            { height: Math.floor(popupHeight * 0.005), type: 'space' },
            { height: Math.floor(popupHeight * 0.1), type: 'power' }
        ];

        // create shells synchronously, populate sections in parallel
        const tasks = [];
        for (const section of sections) {
            const sectionColumn = this._createColumn(null, section.height);
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
        // Create sections
        const sections = [
            { height: Math.floor(popupHeight * 0.12), type: 'space' },
            { height: Math.floor(popupHeight * 0.10), type: 'os' },
            { height: Math.floor(popupHeight * 0.06), type: 'space' },
            { height: Math.floor(popupHeight * 0.35), type: 'cpu' },
            { height: Math.floor(popupHeight * 0.045), type: 'space' },
            { height: Math.floor(popupHeight * 0.22), type: 'gpu' }
        ];

        // create shells synchronously, populate sections in parallel
        const tasks = [];
        for (const section of sections) {
            const sectionColumn = this._createColumn(null, section.height);
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

    _createBackColumn(column, popupHeight) {
        const topEndColumn = this._createColumn(null, Math.floor(popupHeight * 0.1));
        column.add_child(topEndColumn);

        const themeColors = this._updateThemeColors();
        const buttonsRow = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
            style: 'spacing: 6px;'
        });

        const buttonConfigs = [
            {
                key: 'close',
                label: 'X',
                bg: '#f44336',
                onClick: () => {
                    this._indicator.remove_style_class_name('active');
                    this.destroyMainScreen();
                }
            }
        ];

        if (this._showCopyButton) {
            buttonConfigs.push({
                key: 'copy',
                iconPath: `${this._extension.path}/assets/copy-symbolic.svg`,
                bg: '#1e88e5',
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
                        width: 35px; 
                        height: 35px; 
                        border-radius: 5px; 
                        border: 2px solid ${themeColors.accent};
                        font-weight: bold;`,
            });
            if (cfg.iconPath) {
                button.set_child(new St.Icon({
                    gicon: Gio.icon_new_for_string(cfg.iconPath),
                    icon_size: 16,
                }));
            } else {
                button.label = cfg.label;
            }
            button.connect('clicked', cfg.onClick);

            if (cfg.key === 'copy')
                this._copyButton = button;
            else if (cfg.key === 'close')
                this._closeButton = button;

            buttonsRow.add_child(button);
        }
        topEndColumn.add_child(buttonsRow);
    }

    async _copySystemInfoToClipboard() {
        const info = await this._systemLink.getAllInfo();
        if (!info || info.error) {
            return;
        }

        const memory = info.memory || {};
        const network = info.network || {};
        const system = info.system || {};
        const cpu = info.cpu || {};
        const power = info.power || 'Unknown';
        const storage = typeof info.storage === 'string' ? info.storage : '';
        const coreSpeeds = Array.isArray(cpu.coreSpeeds) ? cpu.coreSpeeds : [];
        const storageLines = storage
            ? storage.split('\n').filter(line => line.trim().length > 0).map(line => `  ${line}`)
            : ['  N/A'];

        const memoryLine = `RAM: ${memory.use || 'N/A'} / ${memory.max || 'N/A'} (${memory.percent || 'N/A'}) | ` +
            `Cache: ${memory.cache || 'N/A'} | Swap: ${memory.swapUse || 'N/A'} / ${memory.swapMax || 'N/A'} (${memory.swapPercent || 'N/A'})`;

        const text = [
            `Uptime: ${info.uptime || 'Unknown'}`,
            `OS: ${system.osName || 'Unknown'} [${system.osType || 'Unknown'}]`,
            `Kernel: ${system.kernelVersion || 'Unknown'}`,
            `CPU: ${cpu.cpu || 'Unknown'} x ${cpu.core || '0'}`,
            ...(coreSpeeds.length > 0
                ? ['CPU Per-core:', ...coreSpeeds.map(line => `  ${line}`)]
                : ['CPU Per-core: N/A']),
            `GPU: ${info.gpu || 'Unknown'}`, memoryLine,
            'Storage:',
            ...storageLines,
            `Network: ${network.wifiSSID || 'Unknown'} | LAN: ${network.lanIP || 'Unknown'} | Public: ${network.publicIP || 'Unknown'}`,
            `Power: ${power || 'Unknown'}`
        ].join('\n');

        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(St.ClipboardType.CLIPBOARD, text);

        if (this._copyButton) {
            this._copyButton.set_child(new St.Icon({
                icon_name: 'emblem-ok-symbolic',
                icon_size: 16,
            }));
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
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
            vertical: false,
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
                border: 3px solid ${themeColors.accent};
            `,
            clip_to_allocation: true,
        });

        profileRow.add_child(this._profileBin);

        const deviceInfoUser = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            style: 'padding-left: 15px;',
        });

        this._deviceLabel = new St.Label({
            text: `Device name`,
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 14px;`,
        });

        const deviceNameRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        this._deviceWithUptime = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
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
        // Create container for WiFi and IP info
        const ipAndWiFi_LeftColumn = this._createColumn(null, null);
        // ========== NETWORK SPEED ========== //
        this._wifiLabel = new St.Label({
            text: 'Wi-Fi : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._wifiSpeedLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 13px;`
        });
        const wifiRow = new St.BoxLayout({ vertical: false });
        wifiRow.add_child(this._wifiLabel);
        wifiRow.add_child(this._wifiSpeedLabel);
        ipAndWiFi_LeftColumn.add_child(wifiRow);
        // ========== IP ADDRESSES ========== //
        const publicipRow = new St.BoxLayout({ vertical: false });
        const localipRow = new St.BoxLayout({ vertical: false });
        // Public IP Label
        this._publicIPDescLabel = new St.Label({
            text: 'Public IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`
        });
        this._publicIPLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        publicipRow.add_child(this._publicIPDescLabel);
        publicipRow.add_child(this._publicIPLabel);
        // Local IP Label
        this._localIPDescLabel = new St.Label({
            text: 'Local IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`
        });
        this._localIPLabel = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        localipRow.add_child(this._localIPDescLabel);
        localipRow.add_child(this._localIPLabel);
        ipAndWiFi_LeftColumn.add_child(publicipRow);
        ipAndWiFi_LeftColumn.add_child(localipRow);
        column.add_child(ipAndWiFi_LeftColumn);
        this._queueSectionRefresh('network', 50);
    }

    async _createMemorySection(column) {
        const themeColors = this._updateThemeColors();
        this._memoryHead = new St.Label({
            text: 'Memory',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._memoryUse = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        this._memorySwap = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 10px;`
        });
        this._memoryCache = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 10px;`
        });
        column.add_child(this._memoryHead);
        column.add_child(this._memoryUse);
        column.add_child(this._memorySwap);
        column.add_child(this._memoryCache);
        this._queueSectionRefresh('memory', 100);
    }

    async _createStorageSection(column) {
        const themeColors = this._updateThemeColors();
        this._storageHead = new St.Label({
            text: 'Storage',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._storageBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true
        });
        const storage_scrollView = new St.ScrollView({
            style_class: './assets/custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });
        storage_scrollView.set_child(this._storageBox);
        this._storageBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
            x_expand: true
        }));
        column.add_child(this._storageHead);
        column.add_child(storage_scrollView);
        this._queueSectionRefresh('storage', 250);
    }

    async _createPowerSection(column) {
        const themeColors = this._updateThemeColors();
        this._powerHead = new St.Label({
            text: 'Power',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._powerShow = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        column.add_child(this._powerHead);
        column.add_child(this._powerShow);
        this._queueSectionRefresh('power', 150);
    }

    async _createOSSection(column) {
        const themeColors = this._updateThemeColors();
        this._device_OS = new St.Label({
            text: 'OS : Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 18px;`,
            x_align: Clutter.ActorAlign.START,
        });

        this._device_Kernel = new St.Label({
            text: 'Kernel : Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });

        column.add_child(this._device_OS);
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

        connectHover(this._device_OS);
        connectHover(this._device_Kernel);

        this._queueSectionRefresh('os', 200);
    }

    async _createCPUSection(column) {
        const themeColors = this._updateThemeColors();
        this._cpuHead = new St.Label({
            text: 'Processor',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._cpuName = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 14px;`
        });
        this._coreBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true
        });
        const cpu_scrollView = new St.ScrollView({
            style_class: './assets/custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });
        cpu_scrollView.set_child(this._coreBox);

        this._coreBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
            x_expand: true
        }));

        const cpuHeadBox = new St.BoxLayout({ vertical: true });
        cpuHeadBox.add_child(this._cpuHead);
        cpuHeadBox.add_child(this._cpuName);
        column.add_child(cpuHeadBox);
        column.add_child(cpu_scrollView);
        this._queueSectionRefresh('cpu', 300);
    }

    async _createGPUSection(column) {
        const themeColors = this._updateThemeColors();
        this._gpuHead = new St.Label({
            text: 'Graphics',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._gpuBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            style: `padding: 5px;`
        });
        const gpu_scrollView = new St.ScrollView({
            style_class: './assets/custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true,
        });
        gpu_scrollView.set_child(this._gpuBox);
        column.add_child(this._gpuHead);
        column.add_child(gpu_scrollView);
        this._gpuBox.add_child(new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
            x_expand: true
        }));
        this._queueSectionRefresh('gpu', 450);
    }

    async _updateGPUInfo() {
        if (this._gpuBox) {
            const themeColors = this._updateThemeColors();
            const gpuInfo = await this._systemLink.getGPUInfo();
            updateGPUData({ gpuBox: this._gpuBox, gpuHead: this._gpuHead }, gpuInfo, themeColors, St);
        }
    }

    async _updateDeviceInfo() {
        if (this._deviceWithUptime) {
            const uptime = await this._systemLink.getUptime();
            updateDeviceData({ deviceWithUptime: this._deviceWithUptime }, uptime);
        }
    }

    async _updateNetworkInfo() {
        const networkInfo = await this._systemLink.getNetworkInfo();
        updateNetworkData({
            wifiSpeedLabel: this._wifiSpeedLabel,
            publicIPLabel: this._publicIPLabel,
            localIPLabel: this._localIPLabel
        }, networkInfo);
    }

    async _updateMemoryInfo() {
        if (this._memoryUse && this._memoryCache) {
            try {
                const memoryInfo = await this._systemLink.getMemoryInfo();
                updateMemoryData({
                    memoryUse: this._memoryUse,
                    memorySwap: this._memorySwap,
                    memoryCache: this._memoryCache
                }, memoryInfo);
            } catch (error) {
                logError(error, 'System HUD: Error updating memory info');
                updateMemoryData({
                    memoryUse: this._memoryUse,
                    memorySwap: this._memorySwap,
                    memoryCache: this._memoryCache
                }, null);
            }
        }
    }

    async _updateOSInfo() {
        if (!this._device_OS || !this._device_Kernel)
            return;

        try {
            const systemInfo = await this._systemLink.getSystemInfo();
            this._osDetails = systemInfo;
            updateOSData({
                device_OS: this._device_OS,
                device_Kernel: this._device_Kernel
            }, systemInfo);
        } catch (error) {
            logError(error, 'System HUD: Error updating system info');
            this._osDetails = null;
            this._device_OS.text = 'OS : Unknown';
            this._device_Kernel.text = 'Kernel : Unknown';
        }
    }

    async _updateStorageInfo() {
        if (this._storageBox) {
            const storageInfo = await this._systemLink.getStorageInfo();
            updateStorageData({ storageBox: this._storageBox }, storageInfo, St);
        }
    }

    async _updatePowerInfo() {
        if (this._powerShow) {
            try {
                const powerInfo = await this._systemLink.getPowerInfo();
                updatePowerData({ powerShow: this._powerShow }, powerInfo);
            } catch (error) {
                logError(error, 'System HUD: Error updating power info');
                updatePowerData({ powerShow: this._powerShow }, null);
            }
        }
    }

    async _updateCPUInfo() {
        if (this._coreBox) {
            const cpuInfo = await this._systemLink.getCPUInfo();
            updateCPUData({ cpuName: this._cpuName, coreBox: this._coreBox }, cpuInfo, St);
        }
    }

    async _updateAllInfo() {
        if (!this._main_screen) return;
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



    destroyMainScreen() {
        if (this._main_screen) {
            if (this._mainScreenKeyPressId) {
                this._main_screen.disconnect(this._mainScreenKeyPressId);
                this._mainScreenKeyPressId = null;
            }
            const [x, y] = this._main_screen.get_position();
            const [_, natHeight] = this._main_screen.get_preferred_height(-1);
            if (this._useAnimation) {
                this._main_screen.ease({
                    y: y - natHeight,
                    opacity: 0,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        Main.layoutManager.removeChrome(this._main_screen);
                        this._main_screen.destroy();
                        this._main_screen = null;
                    }
                });
            } else {
                Main.layoutManager.removeChrome(this._main_screen);
                this._main_screen.destroy();
                this._main_screen = null;
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
        this.destroyMainScreen();

        if (this._settings) {
            for (const id of this._settingsSignalIds) {
                try {
                    this._settings.disconnect(id);
                } catch (e) {
                    // ignore disconnect errors
                }
            }
            this._settingsSignalIds = [];
            this._settings = null;
        }
        
        if (this._themeManager) {
            this._themeManager.disconnectThemeChanged(this._themeChangeSignal);
            this._themeManager = null;
        }
        
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        // Remove label animation timeouts
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
    }
}
