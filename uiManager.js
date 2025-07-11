import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export class UIManager {
    constructor(extension, systemInfoCollector) {
        this._extension = extension;
        this._systemInfoCollector = systemInfoCollector;
        this._main_screen = null;
        this._updateTimeoutId = null;
        this._themeSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface'
        });
        this._themeChangeSignal = this._themeSettings.connect('changed::gtk-theme', 
        this._onThemeChanged.bind(this));
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
        const colorScheme = this._themeSettings.get_string('color-scheme');
        const isDarkTheme = colorScheme === 'prefer-dark';

        const backgroundColor = isDarkTheme ? '#212121' : '#f5f5f5';
        const textColor = isDarkTheme ? 'white' : 'black';
        const secondaryTextColor = isDarkTheme ? 'rgb(180, 180, 180)' : 'rgb(45, 45, 45)';
        const accentColor = isDarkTheme ? 'black' : 'white';

        return {
            background: backgroundColor,
            text: textColor,
            secondaryText: secondaryTextColor,
            accent: accentColor,
            isDark: isDarkTheme
        };
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

            this._updateDeviceSectionStyle();
            this._updateNetworkSectionStyle();
            this._updateMemorySectionStyle();
            this._updateStorageSectionStyle();
            this._updatePowerSectionStyle();
            this._updateOSSectionStyle();
            this._updateCPUSectionStyle();
            this._updateGPUInfo();
        }
    }

    _updateNetworkSectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._wifiSpeedLabel)
            this._wifiSpeedLabel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 13px;`);
        if (this._wifiLabel)
            this._wifiLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
        if (this._publicIPLabel)
            this._publicIPLabel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
        if (this._publicIPDescLabel)
            this._publicIPDescLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`);
        if (this._localIPLabel)
            this._localIPLabel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
        if (this._localIPDescLabel)
            this._localIPDescLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`);
    }

    _updateMemorySectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._memoryUse && this._memoryCache) {
            this._memoryUse.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
            this._memoryCache.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
        }
        if (this._memoryHead)
            this._memoryHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
    }

    _updateStorageSectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._storageBox) {
            const children = this._storageBox.get_children();
            for (let i = 0; i < children.length; i++) {
                children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
            }
        }
        if (this._storageHead)
            this._storageHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
    }

    _updatePowerSectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._powerShow)
            this._powerShow.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
        if (this._powerHead)
            this._powerHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
    }

    _updateOSSectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._device_OS)
            this._device_OS.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 18px;`);
        if (this._device_Kernel)
            this._device_Kernel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 16px;`);
    }

    _updateCPUSectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._cpuHead)
            this._cpuHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
        if (this._cpuName)
            this._cpuName.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 14px;`);
        if (this._coreBox) {
            const children = this._coreBox.get_children();
            for (let i = 0; i < children.length; i++) {
                if (children[i] instanceof St.Label) {
                    children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
                }
            }
        }
    }

    _updateDeviceSectionStyle() {
        const themeColors = this._updateThemeColors();
        if (this._deviceWithUptime)
            this._deviceWithUptime.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 16px;`);
        if (this._deviceLabel)
            this._deviceLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 14px;`);
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
            text: await this._systemInfoCollector.getUptime(),
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
        const { download, upload } = await this._systemInfoCollector.getNetworkSpeed();
        const ssid = await this._systemInfoCollector.getWifiSSID();
        const publicIP = await this._systemInfoCollector.getPublicIP();
        const localIP = await this._systemInfoCollector.getLocalIP();
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
        const memoryInfo = await this._systemInfoCollector.getMemoryInfo();
        if (memoryInfo.error) {
            this._memoryUse.text = memoryInfo.error;
            this._memoryCache.text = '';
        } else {
            const { use, max, percent, cache, loadEmoji } = memoryInfo;
            this._memoryUse.text = `${loadEmoji} [ ${use} / ${max} ] [${percent}]`;
            this._memoryCache.text = `Cache ${cache}`;
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
            style_class: 'custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });
        storage_scrollView.set_child(this._storageBox);
        const storageInfo = await this._systemInfoCollector.getStorageInfo();
        const storageInfoLines = storageInfo.split('\n');
        storageInfoLines.forEach((line) => {
            const label = new St.Label({
                text: line,
                style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                x_expand: true
            });
            this._storageBox.add_child(label);
        });
        column.add_child(this._storageHead);
        column.add_child(storage_scrollView);
    }

    async _createPowerSection(column) {
        const themeColors = this._updateThemeColors();
        this._powerHead = new St.Label({
            text: 'Power',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._powerShow = new St.Label({
            text: await this._systemInfoCollector.getPowerInfo(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        column.add_child(this._powerHead);
        column.add_child(this._powerShow);
    }

    async _createOSSection(column) {
        const themeColors = this._updateThemeColors();
        const { osName, osType, kernelVersion } = await this._systemInfoCollector.getSystemInfo();

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
        const cpuInfo = await this._systemInfoCollector.getCPUInfo();
        if (!cpuInfo || !cpuInfo.coreSpeeds) {
            console.error('Failed to get CPU info');
            return;
        }
        this._cpuName.text = `${cpuInfo.cpu} x ${cpuInfo.core}`;
        this._coreBox = new St.BoxLayout({
            vertical: true,
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
            style_class: 'custom-scroll',
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
            if (this._gpuHead)
                this._gpuHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
            const gpuInfo = await this._systemInfoCollector.getGPUInfo();
            if (gpuInfo) {
                const lines = gpuInfo.split('\n').filter(line => line.trim() !== '');
                const children = this._gpuBox.get_children();
                const existingCount = children.length;
                const newCount = lines.length;
                // Update existing labels
                for (let i = 0; i < Math.min(existingCount, newCount); i++) {
                    if (children[i].text !== lines[i]) {
                        children[i].text = lines[i];
                    }
                    children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
                }
                // Add new labels if needed
                if (existingCount < newCount) {
                    for (let i = existingCount; i < newCount; i++) {
                        const label = new St.Label({
                            text: lines[i],
                            style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                            x_expand: true
                        });
                        this._gpuBox.add_child(label);
                    }
                }
            }
        }
    }

    async _updateDeviceInfo() {
        if (this._deviceWithUptime) {
            this._deviceWithUptime.text = await this._systemInfoCollector.getUptime();
        }
    }

    async _updateNetworkInfo() {
        if (this._wifiSpeedLabel) {
            const { download, upload } = await this._systemInfoCollector.getNetworkSpeed();
            const ssid = await this._systemInfoCollector.getWifiSSID();
            this._wifiSpeedLabel.text = `${ssid} ↓ ${download} ↑ ${upload}`;
        }

        if (this._publicIPLabel) {
            this._publicIPLabel.text = await this._systemInfoCollector.getPublicIP();
        }
        if (this._localIPLabel) {
            this._localIPLabel.text = await this._systemInfoCollector.getLocalIP();
        }
    }

    async _updateMemoryInfo() {
        if (this._memoryUse && this._memoryCache) {
            const memoryInfo = await this._systemInfoCollector.getMemoryInfo();
            if (!memoryInfo.error) {
                const { use, max, percent, cache, loadEmoji } = memoryInfo;
                this._memoryUse.text = `${loadEmoji} [ ${use} / ${max} ] [${percent}]`;
                this._memoryCache.text = `Cache ${cache}`;
            }
        }
    }

    async _updateStorageInfo() {
        if (this._storageBox) {
            const storageInfo = await this._systemInfoCollector.getStorageInfo();
            const storageInfoLines = storageInfo.split('\n');
            const children = this._storageBox.get_children();
            
            for (let i = 0; i < Math.min(children.length, storageInfoLines.length); i++) {
                if (children[i].text !== storageInfoLines[i]) {
                    children[i].text = storageInfoLines[i];
                }
            }

            if (children.length < storageInfoLines.length) {
                for (let i = children.length; i < storageInfoLines.length; i++) {
                    const label = new St.Label({
                        text: storageInfoLines[i],
                        style: 'font-weight: bold; font-size: 11px;',
                        x_expand: true
                    });
                    this._storageBox.add_child(label);
                }
            } else if (children.length > storageInfoLines.length) {
                for (let i = storageInfoLines.length; i < children.length; i++) {
                    children[i].hide();
                }
            }
        }
    }

    async _updatePowerInfo() {
        if (this._powerShow) {
            this._powerShow.text = await this._systemInfoCollector.getPowerInfo();
        }
    }

    async _updateCPUInfo() {
        if (this._coreBox) {
            const cpuInfo = await this._systemInfoCollector.getCPUInfo();
            if (cpuInfo && cpuInfo.coreSpeeds) {
                const children = this._coreBox.get_children();
                const existingCount = children.length;
                const newCount = cpuInfo.coreSpeeds.length;
                
                for (let i = 0; i < Math.min(existingCount, newCount); i++) {
                    if (children[i].text !== cpuInfo.coreSpeeds[i]) {
                        children[i].text = cpuInfo.coreSpeeds[i];
                    }
                }
                
                if (existingCount < newCount) {
                    const fragment = new St.BoxLayout({ vertical: true });
                    for (let i = existingCount; i < newCount; i++) {
                        const label = new St.Label({
                            text: cpuInfo.coreSpeeds[i],
                            style: `font-weight: bold; font-size: 11px;`,
                            x_expand: true
                        });
                        fragment.add_child(label);
                    }
                    this._coreBox.add_child(fragment);
                } else if (existingCount > newCount) {
                    for (let i = newCount; i < existingCount; i++) {
                        children[i].hide();
                    }
                }
            }
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
        
        if (this._themeSettings) {
            if (this._themeChangeSignal) {
                this._themeSettings.disconnect(this._themeChangeSignal);
                this._themeChangeSignal = null;
            }
            this._themeSettings = null;
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