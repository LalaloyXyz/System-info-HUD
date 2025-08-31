import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { ThemeManager, updateCPUSectionStyle, updateNetworkSectionStyle, updateMemorySectionStyle, updateStorageSectionStyle, updatePowerSectionStyle, updateOSSectionStyle, updateDeviceSectionStyle, updateGPUSectionStyle } from './modules/themeManager.js';
import {
  updateCPUData,
  updateMemoryData,
  updateNetworkData,
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
        this._themeManager = new ThemeManager();
        this._themeChangeSignal = this._themeManager.connectThemeChanged(
            this._onThemeChanged.bind(this)
        );
        this._useAnimation = true; // Default: use animation
        this._labelTimeoutIds = []; // Track label animation timeouts
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
            const [x, y] = event.get_coords();
            const dx = x - dragStartX;
            const dy = y - dragStartY;
            this._main_screen.set_position(actorStartX + dx, actorStartY + dy);
            return Clutter.EVENT_STOP;
        });

        actor.connect('button-release-event', () => {
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
        const leftColumn = this._createColumn(Math.floor(popupWidth * 0.48));
        const rightColumn = this._createColumn(Math.floor(popupWidth * 0.42));
        const backColumn = this._createColumn(Math.floor(popupWidth * 0.05));

        // Add columns to main screen
        this._main_screen.add_child(frontColumn);
        this._main_screen.add_child(leftColumn);
        this._main_screen.add_child(rightColumn);
        this._main_screen.add_child(backColumn);

        // Enable dragging
        this._enableDrag(this._main_screen);

        // Create and populate UI components
        await this._createLeftColumn(leftColumn, popupHeight);
        await this._createRightColumn(rightColumn, popupHeight);
        this._createBackColumn(backColumn, popupHeight);

        // Set size
        this._main_screen.set_size(popupWidth, popupHeight);
        Main.layoutManager.addChrome(this._main_screen, {
            trackFullscreen: true,
        });

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

        // Start update timer
        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
        }
        this._updateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateAllInfo();
            return true;
        });
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
            { height: Math.floor(popupHeight * 0.025), type: 'space' },
            { height: Math.floor(popupHeight * 0.24), type: 'storage' },
            { height: Math.floor(popupHeight * 0.005), type: 'space' },
            { height: Math.floor(popupHeight * 0.1), type: 'power' }
        ];

        for (const section of sections) {
            const sectionColumn = this._createColumn(null, section.height);
            
            switch (section.type) {
                case 'device':
                    await this._createDeviceSection(sectionColumn);
                    break;
                case 'network':
                    await this._createNetworkSection(sectionColumn);
                    break;
                case 'memory':
                    await this._createMemorySection(sectionColumn);
                    break;
                case 'storage':
                    await this._createStorageSection(sectionColumn);
                    break;
                case 'power':
                    await this._createPowerSection(sectionColumn);
                    break;
            }
            
            column.add_child(sectionColumn);
        }
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

        for (const section of sections) {
            const sectionColumn = this._createColumn(null, section.height);
            
            switch (section.type) {
                case 'os':
                    await this._createOSSection(sectionColumn);
                    break;
                case 'cpu':
                    await this._createCPUSection(sectionColumn);
                    break;
                case 'gpu':
                    await this._createGPUSection(sectionColumn);
                    break;
            }
            
            column.add_child(sectionColumn);
        }
    }

    _createBackColumn(column, popupHeight) {
        const topEndColumn = this._createColumn(null, Math.floor(popupHeight * 0.1));
        column.add_child(topEndColumn);

        const themeColors = this._updateThemeColors();
        this._closeButton = new St.Button({
            style: `background-color: #f44336;
                    color: white;
                    width: 35px; 
                    height: 35px; 
                    border-radius: 5px; 
                    border: 2px solid ${themeColors.accent};\
                    font-weight: bold;`,
            label: 'X',
        });

        this._closeButton.connect('clicked', () => {
            this._indicator.remove_style_class_name('active');
            this.destroyMainScreen();
        });

        topEndColumn.add_child(this._closeButton);
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
            text: await this._systemLink.getUptime(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });

        deviceNameRow.add_child(this._deviceWithUptime);

        deviceInfoUser.add_child(this._deviceLabel);
        deviceInfoUser.add_child(deviceNameRow);

        profileRow.add_child(deviceInfoUser);
        column.add_child(profileRow);
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
        // Get initial network info
        const networkInfo = await this._systemLink.getNetworkInfo();
        const { download, upload } = networkInfo.networkSpeed || { download: '0', upload: '0' };
        const ssid = networkInfo.wifiSSID || 'Unknown';
        const publicIP = networkInfo.publicIP || 'Unknown';
        const localIP = networkInfo.lanIP || 'Unknown';
        this._wifiSpeedLabel = new St.Label({
            text: `${ssid} ↓ ${download} ↑ ${upload}`,
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
            text: publicIP,
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
            text: localIP,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        localipRow.add_child(this._localIPDescLabel);
        localipRow.add_child(this._localIPLabel);
        ipAndWiFi_LeftColumn.add_child(publicipRow);
        ipAndWiFi_LeftColumn.add_child(localipRow);
        column.add_child(ipAndWiFi_LeftColumn);
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
        this._memoryCache = new St.Label({
            text: 'Loading...',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        column.add_child(this._memoryHead);
        column.add_child(this._memoryUse);
        column.add_child(this._memoryCache);
        try {
            const memoryInfo = await this._systemLink.getMemoryInfo();
            if (memoryInfo && memoryInfo.error) {
                this._memoryUse.text = memoryInfo.error;
                this._memoryCache.text = '';
            } else if (memoryInfo) {
                const { use, max, percent, cache, loadEmoji } = memoryInfo;
                this._memoryUse.text = `${loadEmoji} [ ${use} / ${max} ] [${percent}]`;
                this._memoryCache.text = `Cache ${cache}`;
            } else {
                this._memoryUse.text = 'Error: No data';
                this._memoryCache.text = '';
            }
        } catch (error) {
            console.error('Error getting memory info:', error);
            this._memoryUse.text = 'Error: Failed to load';
            this._memoryCache.text = '';
        }
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
        try {
            const storageInfo = await this._systemLink.getStorageInfo();
            const storageInfoLines = storageInfo.split('\n');
            storageInfoLines.forEach((line) => {
                const label = new St.Label({
                    text: line,
                    style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                    x_expand: true
                });
                this._storageBox.add_child(label);
            });
        } catch (error) {
            console.error('Error getting storage info:', error);
            const label = new St.Label({
                text: 'Error: Failed to load storage info',
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                x_expand: true
            });
            this._storageBox.add_child(label);
        }
        column.add_child(this._storageHead);
        column.add_child(storage_scrollView);
    }

    async _createPowerSection(column) {
        const themeColors = this._updateThemeColors();
        this._powerHead = new St.Label({
            text: 'Power',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        try {
            const powerInfo = await this._systemLink.getPowerInfo();
            this._powerShow = new St.Label({
                text: powerInfo || 'No battery found',
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
            });
        } catch (error) {
            console.error('Error getting power info:', error);
            this._powerShow = new St.Label({
                text: 'Error: Failed to load',
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
            });
        }
        column.add_child(this._powerHead);
        column.add_child(this._powerShow);
    }

    async _createOSSection(column) {
        const themeColors = this._updateThemeColors();
        try {
            const systemInfo = await this._systemLink.getSystemInfo();
            const { osName, osType, kernelVersion } = systemInfo || { osName: 'Unknown', osType: 'Unknown', kernelVersion: 'Unknown' };

            this._device_OS = new St.Label({
                text: `OS : ${osName} [${osType}]`,
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 18px;`,
                x_align: Clutter.ActorAlign.START,
            });

            this._device_Kernel = new St.Label({
                text: `Kernel : Linux ${kernelVersion}`,
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
                x_align: Clutter.ActorAlign.START,
            });
            
            column.add_child(this._device_OS);
            column.add_child(this._device_Kernel);
        } catch (error) {
            console.error('Error getting system info:', error);
            this._device_OS = new St.Label({
                text: 'OS : Unknown',
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 18px;`,
                x_align: Clutter.ActorAlign.START,
            });

            this._device_Kernel = new St.Label({
                text: 'Kernel : Unknown',
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
                x_align: Clutter.ActorAlign.START,
            });
            
            column.add_child(this._device_OS);
            column.add_child(this._device_Kernel);
        }
    }

    async _createCPUSection(column) {
        const themeColors = this._updateThemeColors();
        this._cpuHead = new St.Label({
            text: 'Processor',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._cpuName = new St.Label({
            text: '',
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 14px;`
        });
        // Get CPU info asynchronously
        try {
            const cpuInfo = await this._systemLink.getCPUInfo();
            if (!cpuInfo || !cpuInfo.coreSpeeds) {
                console.error('Failed to get CPU info');
                this._cpuName.text = 'CPU: Unknown';
                return;
            }
            this._cpuName.text = `${cpuInfo.cpu} x ${cpuInfo.core}`;
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
            cpuInfo.coreSpeeds.forEach((line) => {
                const label = new St.Label({
                    text: line,
                    style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                    x_expand: true
                });
                this._coreBox.add_child(label);
            });
            // Use a vertical box for header and CPU name
            const cpuHeadBox = new St.BoxLayout({ vertical: true });
            cpuHeadBox.add_child(this._cpuHead);
            cpuHeadBox.add_child(this._cpuName);
            column.add_child(cpuHeadBox);
            column.add_child(cpu_scrollView);
        } catch (error) {
            console.error('Error getting CPU info:', error);
            this._cpuName.text = 'CPU: Error loading';
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
            
            const errorLabel = new St.Label({
                text: 'Error: Failed to load CPU info',
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                x_expand: true
            });
            this._coreBox.add_child(errorLabel);
            
            // Use a vertical box for header and CPU name
            const cpuHeadBox = new St.BoxLayout({ vertical: true });
            cpuHeadBox.add_child(this._cpuHead);
            cpuHeadBox.add_child(this._cpuName);
            column.add_child(cpuHeadBox);
            column.add_child(cpu_scrollView);
        }
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
        // Initial GPU info population
        await this._updateGPUInfo();
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
                    memoryCache: this._memoryCache
                }, memoryInfo);
            } catch (error) {
                console.error('Error updating memory info:', error);
                updateMemoryData({
                    memoryUse: this._memoryUse,
                    memoryCache: this._memoryCache
                }, null);
            }
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
                console.error('Error updating power info:', error);
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
        await Promise.all([
            this._updateDeviceInfo(),
            this._updateNetworkInfo(),
            this._updateMemoryInfo(),
            this._updateStorageInfo(),
            this._updatePowerInfo(),
            this._updateCPUInfo(),
            this._updateGPUInfo()
        ]);
    }

    destroyMainScreen() {
        if (this._main_screen) {
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
    }

    destroy() {
        this.destroyMainScreen();
        
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
    }
} 