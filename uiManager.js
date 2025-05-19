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
        this._colorSchemeChangeSignal = this._themeSettings.connect('changed::color-scheme',
            this._onThemeChanged.bind(this));
    }

    createIndicator() {
        this._indicator = new PanelMenu.Button(0.0, this._extension.metadata.name, false);
        this._indicator.add_style_class_name('panel-button');

        this._label = new St.Label({
            text: 'Info',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._indicator.add_child(this._label);

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

        // Set size and position
        this._main_screen.set_size(popupWidth, popupHeight);
        Main.layoutManager.addChrome(this._main_screen, {
            trackFullscreen: true,
        });

        // Center the window
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._main_screen) return GLib.SOURCE_REMOVE;

            const [_, natWidth] = this._main_screen.get_preferred_width(-1);
            const [__, natHeight] = this._main_screen.get_preferred_height(-1);
            const x = Math.floor((monitor.width - natWidth) / 2) + monitor.x;
            const y = Math.floor((monitor.height - natHeight) / 2) + monitor.y;

            this._main_screen.set_position(x, y);
            return GLib.SOURCE_REMOVE;
        });

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
        const closeButton = new St.Button({
            style: `background-color: #f44336; 
                    color: white; 
                    width: 35px; 
                    height: 35px; 
                    border-radius: 5px; 
                    border: 2px solid ${themeColors.accent};
                    font-weight: bold;`,
            label: 'X',
        });

        closeButton.connect('clicked', () => {
            this._indicator.remove_style_class_name('active');
            this.destroyMainScreen();
        });

        topEndColumn.add_child(closeButton);
    }

    async _createDeviceSection(column) {
        const themeColors = this._updateThemeColors();
        const userName = GLib.get_user_name();
        const profileImagePath = `/var/lib/AccountsService/icons/${userName}`;
        const avatarSize = Math.floor(column.height * 0.9);

        const profileRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        const profileBin = new St.Bin({
            width: avatarSize,
            height: avatarSize,
            style: `
                background-image: url("file://${profileImagePath}");
                background-size: cover;
                background-position: center;
                border-radius: 360px;
                border: 3px solid ${themeColors.accent};
            `,
            clip_to_allocation: true,
        });

        profileRow.add_child(profileBin);

        const deviceInfoUser = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            style: 'padding-left: 15px;',
        });

        const deviceLabel = new St.Label({
            text: `Device name`,
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 14px;`,
        });

        const deviceNameRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        this._deviceWithUptime = new St.Label({
            text: await this._systemInfoCollector.getUptime(),
            style: `font-weight: bold; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });

        deviceNameRow.add_child(this._deviceWithUptime);

        deviceInfoUser.add_child(deviceLabel);
        deviceInfoUser.add_child(deviceNameRow);

        profileRow.add_child(deviceInfoUser);
        column.add_child(profileRow);
    }

    async _createNetworkSection(column) {
        const themeColors = this._updateThemeColors();
        
        // Create container for WiFi and IP info
        const ipAndWiFi_LeftColumn = this._createColumn(null, null);
        
        // ========== NETWORK SPEED ========== //
        const wifiLabel = new St.Label({
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
            style: `font-weight: bold; font-size: 13px;`
        });
        const wifiRow = new St.BoxLayout({ vertical: false });
        wifiRow.add_child(wifiLabel);
        wifiRow.add_child(this._wifiSpeedLabel);
        ipAndWiFi_LeftColumn.add_child(wifiRow);

        // ========== IP ADDRESSES ========== //
        const publicipRow = new St.BoxLayout({ vertical: false });
        const localipRow = new St.BoxLayout({ vertical: false });

        // Public IP Label
        publicipRow.add_child(new St.Label({
            text: 'Public IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`
        }));
        this._publicIPLabel = new St.Label({
            text: publicIP,
            style: `font-weight: bold; font-size: 12px;`
        });
        publicipRow.add_child(this._publicIPLabel);

        // Local IP Label
        localipRow.add_child(new St.Label({
            text: 'Local IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`
        }));
        this._localIPLabel = new St.Label({
            text: localIP,
            style: `font-weight: bold; font-size: 12px;`
        });
        localipRow.add_child(this._localIPLabel);

        ipAndWiFi_LeftColumn.add_child(publicipRow);
        ipAndWiFi_LeftColumn.add_child(localipRow);
        
        column.add_child(ipAndWiFi_LeftColumn);
    }

    async _createMemorySection(column) {
        const themeColors = this._updateThemeColors();
        const memoryHead = new St.Label({
            text: 'Memory',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });

        this._memoryUse = new St.Label({
            text: 'Loading...',
            style: `font-weight: bold; font-size: 12px;`
        });

        this._memoryCache = new St.Label({
            text: 'Loading...',
            style: `font-weight: bold; font-size: 12px;`
        });

        column.add_child(memoryHead);
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
        const storageHead = new St.Label({
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
                style: 'font-weight: bold; font-size: 11px;',
                x_expand: true
            });
            this._storageBox.add_child(label);
        });

        column.add_child(storageHead);
        column.add_child(storage_scrollView);
    }

    async _createPowerSection(column) {
        const themeColors = this._updateThemeColors();
        const powerHead = new St.Label({
            text: 'Power',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });

        this._powerShow = new St.Label({
            text: await this._systemInfoCollector.getPowerInfo(),
            style: `font-weight: bold; font-size: 12px;`
        });

        column.add_child(powerHead);
        column.add_child(this._powerShow);
    }

    async _createOSSection(column) {
        const themeColors = this._updateThemeColors();
        const { osName, osType, kernelVersion } = await this._systemInfoCollector.getSystemInfo();

        const device_OS = new St.Label({
            text: `OS : ${osName} [${osType}]`,
            style: `font-weight: bold; font-size: 18px;`,
            x_align: Clutter.ActorAlign.START,
        });

        const device_Kernel = new St.Label({
            text: `Kernel : Linux ${kernelVersion}`,
            style: `font-weight: bold; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });
        
        column.add_child(device_OS);
        column.add_child(device_Kernel);
    }

    async _createCPUSection(column) {
        const themeColors = this._updateThemeColors();
        
        // Create CPU section container
        const Processor_RightColumn = this._createColumn(null, null);
        
        // Get CPU info asynchronously
        const cpuInfo = await this._systemInfoCollector.getCPUInfo();
        if (!cpuInfo || !cpuInfo.coreSpeeds) {
            console.error('Failed to get CPU info');
            return;
        }

        const cpuHead = new St.Label({
            text: 'Processor',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        const cpuName = new St.Label({
            text: `${cpuInfo.cpu} x ${cpuInfo.core}`,
            style: `font-weight: bold; font-size: 14px;`
        });

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
                style: 'font-weight:bold; font-size:11px;',
                x_expand: true
            });
            this._coreBox.add_child(label);
        });

        Processor_RightColumn.add_child(cpuHead);
        Processor_RightColumn.add_child(cpuName);
        Processor_RightColumn.add_child(cpu_scrollView);
        
        column.add_child(Processor_RightColumn);
    }

    async _createGPUSection(column) {
        const themeColors = this._updateThemeColors();
        
        const gpuHead = new St.Label({
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

        column.add_child(gpuHead);
        column.add_child(gpu_scrollView);

        this._updateGPUInfo();
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

    async _updateGPUInfo() {
        if (this._gpuBox) {
            const gpuInfo = await this._systemInfoCollector.getGPUInfo();
            if (gpuInfo) {
                const lines = gpuInfo.split('\n').filter(line => line.trim() !== '');
                let blocks = [];
                let currentBlock = [];
                
                lines.forEach((line) => {
                    if (line.startsWith('GPU')) {
                        if (currentBlock.length > 0) {
                            blocks.push(currentBlock);
                            currentBlock = [];
                        }
                        currentBlock = [line];
                    } else {
                        currentBlock.push(line);
                    }
                });
                
                if (currentBlock.length > 0) {
                    blocks.push(currentBlock);
                }

                let allLines = [];
                blocks.forEach((block, index) => {
                    allLines = [...allLines, ...block];
                    if (index < blocks.length - 1) {
                        allLines.push(' ');
                    }
                });

                const children = this._gpuBox.get_children();
                const existingCount = children.length;
                const newCount = allLines.length;

                // Update existing labels
                for (let i = 0; i < Math.min(existingCount, newCount); i++) {
                    if (children[i].text !== allLines[i]) {
                        children[i].text = allLines[i];
                    }
                }
                
                if (existingCount < newCount) {
                    for (let i = existingCount; i < newCount; i++) {
                        const label = new St.Label({
                            text: allLines[i],
                            style: `font-weight: bold; font-size: 11px;`,
                            x_expand: true
                        });
                        this._gpuBox.add_child(label);
                    }
                } 
                // Hide excess labels if needed
                else if (existingCount > newCount) {
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
            Main.layoutManager.removeChrome(this._main_screen);
            this._main_screen.destroy();
            this._main_screen = null;
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
            if (this._colorSchemeChangeSignal) {
                this._themeSettings.disconnect(this._colorSchemeChangeSignal);
                this._colorSchemeChangeSignal = null;
            }
            this._themeSettings = null;
        }
        
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
} 