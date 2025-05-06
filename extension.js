import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
const ByteArray = imports.byteArray;

export default class mainShow extends Extension {
    enable() {
        this._cache = {
            gpuInfo: { data: null, timestamp: 0 },
            cpuInfo: { data: null, timestamp: 0 },
            systemInfo: { data: null, timestamp: 0 },
            networkInterface: { lastIface: null, lastRx: 0, lastTx: 0, lastTimestamp: 0 },
            themeColors: { background: null, text: null, secondaryText: null, accent: null }
        };

        this._cacheTTL = {
            gpuInfo: 5000,
            cpuInfo: 2000,
            systemInfo: 60000,
            wifiSSID: 10000,
            themeColors: 5000
        };

        this._updateFrequency = 1;

        this._themeSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface'
        });
        this._themeChangeSignal = this._themeSettings.connect('changed::gtk-theme', 
            this._onThemeChanged.bind(this));
        this._colorSchemeChangeSignal = this._themeSettings.connect('changed::color-scheme',
            this._onThemeChanged.bind(this));
            
        this._updateThemeColors();

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        this._indicator.add_style_class_name('panel-button');

        this._label = new St.Label({
            text: 'Info',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._indicator.add_child(this._label);

        this._indicator.connect('button-press-event', () => {
            const isActive = this._indicator.has_style_class_name('active');

            if (isActive) {
                this._indicator.remove_style_class_name('active');
                this._destroyMainScreen();
            } else {
                this._indicator.add_style_class_name('active');
                this._showMainScreen();
            }
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._uptimeTimeoutId = null;
        this._deviceWithUptime = null;
    }

    _updateThemeColors() {
        const currentTime = Date.now();
        if (this._cache.themeColors.timestamp && 
            currentTime - this._cache.themeColors.timestamp < this._cacheTTL.themeColors) {
            return this._cache.themeColors;
        }
        
        const colorScheme = this._themeSettings.get_string('color-scheme');
        const isDarkTheme = colorScheme === 'prefer-dark';

        const backgroundColor = isDarkTheme ? '#212121' : '#f5f5f5';
        const textColor = isDarkTheme ? 'white' : 'black';
        const secondaryTextColor = isDarkTheme ? 'rgb(180, 180, 180)' : 'rgb(100, 100, 100)';
        const accentColor = isDarkTheme ? 'black' : 'white';

        this._cache.themeColors = {
            background: backgroundColor,
            text: textColor,
            secondaryText: secondaryTextColor,
            accent: accentColor,
            isDark: isDarkTheme,
            timestamp: currentTime
        };
        
        return this._cache.themeColors;
    }
    
    _onThemeChanged() {
        this._cache.themeColors.timestamp = 0;
        this._updateThemeColors();

        if (this._main_screen) {
            this._destroyMainScreen();
            this._showMainScreen();
        }
    }

    // ========== UI COMPONENT HELPERS ========== //
    _createColumn_width(width, backgroundColor = null) {
        const themeColors = this._updateThemeColors();
        const bgColor = backgroundColor || 'transparent';
        
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${bgColor}; border: 0px solid ${themeColors.accent};`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        column.set_width(width);
        return column;
    }

    _createColumn_height(height, backgroundColor = null) {
        const themeColors = this._updateThemeColors();
        const bgColor = backgroundColor || 'transparent';
        
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${bgColor}; border: 0px solid ${themeColors.accent};`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        column.set_height(height);
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

    // ========== DATA FETCHERS ========== //
    _getUptime() {
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/uptime');
            if (ok) {
                const uptimeSeconds = parseFloat(imports.byteArray.toString(contents).split(' ')[0]);
                const days = Math.floor(uptimeSeconds / 86400);
                const hours = Math.floor((uptimeSeconds % 86400) / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = Math.floor(uptimeSeconds % 60);
    
                const DeviceName = GLib.get_host_name();
                return `${DeviceName} : ${days}d ${hours}h ${minutes}m ${seconds}s`;
            }
        } catch (e) {
            log('Failed to get uptime: ' + e.message);
        }
        return 'Unknown uptime';
    }

    _updateUptime() {
        if (this._deviceWithUptime) {
            this._deviceWithUptime.text = this._getUptime();
        }
        return true;
    }    

    _getCachedSystemInfo() {
        const now = Date.now();
        if (this._cache.systemInfo.data && 
            now - this._cache.systemInfo.timestamp < this._cacheTTL.systemInfo) {
            return this._cache.systemInfo.data;
        }

        const systemInfo = this._getSystemInfo();
        this._cache.systemInfo = {
            data: systemInfo,
            timestamp: now
        };
        return systemInfo;
    }

    _getSystemInfo() {
        let osName = 'Unknown OS';
        try {
            const [ok, osReleaseContent] = GLib.file_get_contents('/etc/os-release');
            if (ok) {
                const lines = imports.byteArray.toString(osReleaseContent).split('\n');
                for (const line of lines) {
                    if (line.startsWith('PRETTY_NAME=')) {
                        osName = line.split('=')[1].replace(/"/g, '');
                        break;
                    }
                }
            }
        } catch (e) {
            log('Failed to read /etc/os-release: ' + e.message);
        }
    
        let osType = 'Unknown Arch';
        try {
            const [, archOut] = GLib.spawn_command_line_sync('uname -m');
            osType = imports.byteArray.toString(archOut).trim();
        } catch (e) {
            log('Failed to get OS architecture: ' + e.message);
        }
    
        let kernelVersion = 'Unknown Kernel';
        try {
            const [, stdout] = GLib.spawn_command_line_sync('uname -r');
            kernelVersion = imports.byteArray.toString(stdout).trim();
        } catch (e) {
            log('Failed to get kernel version: ' + e.message);
        }
    
        return { osName, osType, kernelVersion };
    }
    
    _getLanIPAddress() {
        try {
            const [ok, out] = GLib.spawn_command_line_sync("ip route get 1.1.1.1");
            if (ok) {
                const output = imports.byteArray.toString(out);
                const match = output.match(/src (\d+\.\d+\.\d+\.\d+)/);
                if (match) {
                    return match[1];
                }
            }
        } catch (e) {
            log('Failed to get LAN IP: ' + e.message);
        }
        return 'Unknown IP';
    }    

    _getWifiSSID() {
        try {
            const [ok, out] = GLib.spawn_command_line_sync("iwgetid -r");
            if (ok) {
                return imports.byteArray.toString(out).trim() || "Not connected";
            }
        } catch (e) {
            log('Failed to get SSID: ' + e.message);
        }
        return 'Unknown Wi-Fi';
    }    

    _getNetworkSpeed() {
        try {
            const [ok, data] = GLib.file_get_contents('/proc/net/dev');
            if (!ok) throw new Error("Failed to read /proc/net/dev");
    
            const lines = data.toString().split('\n').slice(2);
            let activeIface = null;
            let maxTraffic = 0;
            let rx = 0, tx = 0;
    
            for (const line of lines) {
                const parts = line.trim().split(/[:\s]+/);
                if (parts.length < 10) continue;
    
                const iface = parts[0];
                const ifaceRx = parseInt(parts[1], 10);
                const ifaceTx = parseInt(parts[9], 10);
    
                if (iface === 'lo' || (ifaceRx === 0 && ifaceTx === 0)) continue;
    
                const traffic = ifaceRx + ifaceTx;
                if (traffic > maxTraffic) {
                    maxTraffic = traffic;
                    activeIface = iface;
                    rx = ifaceRx;
                    tx = ifaceTx;
                }
            }
    
            const now = Date.now();
            let down = '0', up = '0';
    
            if (this._cache.networkInterface.lastTimestamp && activeIface === this._cache.networkInterface.lastIface) {
                const dt = (now - this._cache.networkInterface.lastTimestamp) / 1000;
                down = this._formatSpeed((rx - this._cache.networkInterface.lastRx) / dt);
                up = this._formatSpeed((tx - this._cache.networkInterface.lastTx) / dt);
            }
    
            this._cache.networkInterface = {
                lastIface: activeIface,
                lastRx: rx,
                lastTx: tx,
                lastTimestamp: now
            };
    
            return { download: down, upload: up };
        } catch (e) {
            log('NetSpeed error: ' + e.message);
            return { download: '0', upload: '0' };
        }
    }
    
    _formatSpeed(bps) {
        if (bps > 1024 * 1024)
            return (bps / (1024 * 1024)).toFixed(2) + ' MB/s';
        if (bps > 1024)
            return (bps / 1024).toFixed(2) + ' kB/s';
        return bps.toFixed(2) + ' B/s';
    }    

    _updateWifiSpeed() {
        const { download, upload } = this._getNetworkSpeed();
        this._wifiSpeedLabel.text = `${this._getWifiSSID()} ↓ ${download} ↑ ${upload}`;
        return true;
    }

    _getCachedCPUInfo() {
        const now = Date.now();
        if (this._cache.cpuInfo.data && 
            now - this._cache.cpuInfo.timestamp < this._cacheTTL.cpuInfo) {
            return this._cache.cpuInfo.data;
        }

        const cpuInfo = this._getCPUInfo();
        this._cache.cpuInfo = {
            data: cpuInfo,
            timestamp: now
        };
        return cpuInfo;
    }

    _getCPUInfo() {
        try {
            let [ok, out] = GLib.file_get_contents('/proc/cpuinfo');
            if (!ok) return;
    
            let text = out.toString();
            let modelMatch = text.match(/^model name\s+:\s+(.+)$/m);
            let modelName = modelMatch ? modelMatch[1].trim() : "Unknown";
    
            let coreSpeeds = {};
            let processorIds = [];
            let coreIdMap = {};
            let lines = text.split('\n');
            let currentProcessorId = null;
    
            for (let line of lines) {
                if (line.startsWith('processor')) {
                    currentProcessorId = line.split(':')[1].trim();
                    processorIds.push(currentProcessorId);
                } else if (line.startsWith('core id') && currentProcessorId !== null) {
                    let coreId = line.split(':')[1].trim();
                    coreIdMap[currentProcessorId] = coreId;
                } else if (line.startsWith('cpu MHz') && currentProcessorId !== null) {
                    let speed = line.split(':')[1].trim();
                    coreSpeeds[currentProcessorId] = Math.floor(parseFloat(speed));
                }
            }
    
            let [res, sensorOut, err, status] = GLib.spawn_command_line_sync("sensors");
            let sensorText = sensorOut.toString();
            let coreTemps = {};
            let coreTempRegex = /^Core\s+(\d+):\s+\+([\d.]+)°C/mg;
            let match;
            while ((match = coreTempRegex.exec(sensorText)) !== null) {
                let id = match[1];
                let temp = parseFloat(match[2]);
                coreTemps[id] = temp.toFixed(1);
            }
    
            let result = [];
            processorIds.sort((a, b) => parseInt(a) - parseInt(b)).forEach((pid) => {
                let coreName = `Core-${String(pid).padStart(2, '0')}    [`;
                let speed = coreSpeeds[pid] || "N/A";
                let coreId = coreIdMap[pid] || "0";
                let temp = coreTemps[coreId] || "N/A";
    
                let speedEmoji = "⬜";
                if (speed >= 3000) speedEmoji = "🟥";
                else if (speed >= 2250) speedEmoji = "🟧";
                else if (speed >= 1500) speedEmoji = "🟨";
                else if (speed >= 750) speedEmoji = "🟩";
                else speedEmoji = "⬜️";
    
                let tempEmoji = "⬜️";
                if (temp !== "N/A") {
                    let tempNum = parseFloat(temp);
                    if (tempNum >= 80) tempEmoji = "🟥";
                    else if (tempNum >= 70) tempEmoji = "🟧";
                    else if (tempNum >= 55) tempEmoji = "🟨";
                    else if (tempNum >= 40) tempEmoji = "🟩";
                    else if (tempNum >= 30) tempEmoji = "⬜️";
                    else tempEmoji = "🟦";
                }
    
                let speedStr = `${speed} MHz`.padEnd(10);
                let tempStr = `]    ${tempEmoji} Temp   [ ${temp}°C ]`;
    
                if (speed < 1000) result.push(`${speedEmoji} ${coreName}       ${speedStr}   ${tempStr}`);
                             else result.push(`${speedEmoji} ${coreName}     ${speedStr}    ${tempStr}`);
            });
    
            return {
                cpu: modelName,
                core: processorIds.length,
                coreSpeeds: result
            };
    
        } catch (e) {
            logError(e);
        }
    }    

    _updateCPUInfo() {
        let cpuInfo = this._getCachedCPUInfo();
        if (cpuInfo) {
            this._coreBox.destroy_all_children();
            cpuInfo.coreSpeeds.forEach((line) => {
                const label = new St.Label({
                    text: line,
                    style: `font-weight: bold; font-size: 11px;`,
                    x_expand: true
                });
                this._coreBox.add_child(label);
            });
        }
        return true;
    }  
    
    _getCachedGpuInfo() {
        const now = Date.now();
        if (this._cache.gpuInfo.data && 
            now - this._cache.gpuInfo.timestamp < this._cacheTTL.gpuInfo) {
            return this._cache.gpuInfo.data;
        }

        const gpuInfo = this._getGpuInfo();
        this._cache.gpuInfo = {
            data: gpuInfo,
            timestamp: now
        };
        return gpuInfo;
    }

    _getGpuInfo() {   
        try {
            let resultList = [];
    
            // Check for NVIDIA
            let [nvidiaOk, nvidiaOut] = GLib.spawn_command_line_sync("sh -c \"command -v nvidia-smi\"");
            if (nvidiaOk && nvidiaOut && ByteArray.toString(nvidiaOut).trim() !== "") {
                let [ok, out] = GLib.spawn_command_line_sync("sh -c \"nvidia-smi --query-gpu=name,memory.total,memory.used,temperature.gpu --format=csv,noheader,nounits\"");
                if (ok && out) {
                    let nvidiaData = ByteArray.toString(out).trim().split('\n');
                    nvidiaData.forEach(line => {
                        let [name, total, used, temp] = line.split(',').map(s => s.trim());
    
                        let load = Math.round((parseInt(used) / parseInt(total)) * 100);
    
                        let loadEmoji = "⬜️";
                        if (load >= 80) loadEmoji = "🟥";
                        else if (load >= 60) loadEmoji = "🟧";
                        else if (load >= 50) loadEmoji = "🟨";
                        else if (load >= 40) loadEmoji = "🟩";
                        else loadEmoji = "⬜️";
    
                        let tempEmoji = "⬜️";
                        if (temp !== "N/A") {
                            let tempNum = parseFloat(temp);
                            if (tempNum >= 80) tempEmoji = "🟥";
                            else if (tempNum >= 70) tempEmoji = "🟧";
                            else if (tempNum >= 55) tempEmoji = "🟨";
                            else if (tempNum >= 40) tempEmoji = "🟩";
                            else tempEmoji = "⬜️";
                        }
    
                        resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${used}MB / ${total}MB ] [${load}%] ${tempEmoji} Temp [${temp}°C]`);
                    });
                }
            }
    
            // Check for AMD
            let [amdToolOk, amdToolOut] = GLib.spawn_command_line_sync("sh -c \"command -v rocm-smi\"");
            if (amdToolOk && amdToolOut && ByteArray.toString(amdToolOut).trim() !== "") {
                let [ok, out] = GLib.spawn_command_line_sync("sh -c \"rocm-smi --showproductname --showmemuse --json\"");
                if (ok && out) {
                    let jsonStr = ByteArray.toString(out).trim();
                    let amdInfo = JSON.parse(jsonStr);
                    for (let key in amdInfo) {
                        let gpu = amdInfo[key];
                        if (gpu["Card series"]) {
                            let name = gpu["Card series"];
                            let used = parseInt(gpu["VRAM Used Memory (B)"]) / (1024 * 1024);
                            let total = parseInt(gpu["VRAM Total Memory (B)"]) / (1024 * 1024);
                            let temp = gpu["Temperature (C)"];
    
                            let load = Math.round((used / total) * 100);
    
                            let loadEmoji = "⬜️";
                            if (load >= 80) loadEmoji = "🟥";
                            else if (load >= 60) loadEmoji = "🟧";
                            else if (load >= 50) loadEmoji = "🟨";
                            else if (load >= 40) loadEmoji = "🟩";
                            else loadEmoji = "⬜️";
    
                            let tempEmoji = "⬜️";
                            if (temp !== "N/A") {
                                let tempNum = parseFloat(temp);
                                if (tempNum >= 80) tempEmoji = "🟥";
                                else if (tempNum >= 70) tempEmoji = "🟧";
                                else if (tempNum >= 55) tempEmoji = "🟨";
                                else if (tempNum >= 40) tempEmoji = "🟩";
                                else tempEmoji = "⬜️";
                            }
    
                            resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${Math.round(used)}MB / ${Math.round(total)}MB ] [${load}%] ${tempEmoji} Temp [${temp}°C]`);
                        }
                    }
                }
            }
    
            let [intelOk, intelOut] = GLib.spawn_command_line_sync("sh -c \"lspci | grep -i 'VGA' | grep -i 'Intel'\"");
            if (intelOk && intelOut) {
                let intelData = ByteArray.toString(intelOut).trim();
                if (intelData !== "") {
                    let matches = intelData.match(/\[([^\]]+)\] \((rev [^\)]+)\)/);
                    if (matches && matches.length >= 3) {
                        let gpuModel = matches[1];
                        resultList.push(`GPU${resultList.length} - [ ${gpuModel} ]`);
                    }
                }
            }

            if (resultList.length === 0) {
                let [pciOk, pciOut] = GLib.spawn_command_line_sync("sh -c \"lspci | grep -E 'VGA|3D'\"");
                if (pciOk && pciOut) {
                    let output = ByteArray.toString(pciOut).trim();
                    if (output !== "") {
                        resultList = output.split('\n').map(line => line.replace(/.*: /, ''));
                    }
                }
            }
    
            return resultList.length > 0 ? resultList.join('\n\n') : 'GPU info not available (sudo or drivers may be required)';
        } catch (e) {
            logError(`Error fetching GPU info: ${e}`);
            return 'Error fetching GPU info';
        }
    }           

    _updateGpuData() {
        const gpuInfo = this._getCachedGpuInfo();
        if (gpuInfo) {
            this._gpuBox.destroy_all_children();
    
            const lines = gpuInfo.split('\n');
            let currentBlock = [];
    
            lines.forEach((line) => {
                if (line.trim() === '') return;
                if (line.startsWith('GPU')) {
                    if (currentBlock.length > 0) {
                        currentBlock.forEach((blockLine) => {
                            const label = new St.Label({
                                text: blockLine,
                                style: `font-weight: bold; font-size: 11px;`,
                                x_expand: true
                            });
                            this._gpuBox.add_child(label);
                        });
 
                        this._gpuBox.add_child(new St.Label({
                            text: ' ',
                            style: 'font-size: 8px;',
                            x_expand: true
                        }));
                    }
                    currentBlock = [line];
                } else {
                    currentBlock.push(line);
                }
            });

            if (currentBlock.length > 0) {
                currentBlock.forEach((blockLine) => {
                    const label = new St.Label({
                        text: blockLine,
                        style: `font-weight: bold; font-size: 11px;`,
                        x_expand: true
                    });
                    this._gpuBox.add_child(label);
                });
            }
        }
        return true;
    }    
    
    // ========== MAIN SCREEN UI ========== //
    _showMainScreen() {
        const themeColors = this._updateThemeColors();
        const monitor = Main.layoutManager.primaryMonitor;
        const popupWidth = Math.floor(monitor.width * 0.4);
        const popupHeight = Math.floor(monitor.height * 0.4);

        this._main_screen = new St.BoxLayout({
            vertical: false,
            style: `background-color: ${themeColors.background}; border-radius: 40px; border: 2px solid ${themeColors.accent};`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        // ========== CREATE COLUMN ========== //
        const frontColumn = this._createColumn_width(Math.floor(popupWidth * 0.05));
        const leftColumn = this._createColumn_width(Math.floor(popupWidth * 0.48));
        const rightColumn = this._createColumn_width(Math.floor(popupWidth * 0.42));
        const backColumn = this._createColumn_width(Math.floor(popupWidth * 0.05));

        // ========== CREATE LEFT ========== //
        const topLeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.06));
        const top1_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.18));
        const space1_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.05));
        const top2_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.1));
        const space2_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.025));

        // ========== CREATE RIGHT ========== //
        const topRightColumn = this._createColumn_height(Math.floor(popupHeight * 0.12));
        const top1_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.12));
        const space1_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.05));
        const top2_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.35));
        const space2_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.045));
        const top3_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.22));

        this._enableDrag(this._main_screen);

        this._main_screen.add_child(frontColumn);
        this._main_screen.add_child(leftColumn);
        this._main_screen.add_child(rightColumn);
        this._main_screen.add_child(backColumn);

        // ========== LEFT COLUMN ========== //
        leftColumn.add_child(topLeftColumn);
        leftColumn.add_child(top1_LeftColumn);
        leftColumn.add_child(space1_LeftColumn);
        leftColumn.add_child(top2_LeftColumn);
        leftColumn.add_child(space2_LeftColumn);

        // ========== DEVICE PROFILE ========== //
        const userName = GLib.get_user_name();
        const profileImagePath = `/var/lib/AccountsService/icons/${userName}`;
        const avatarSize = Math.floor(popupHeight * 0.18);

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
            text: this._getUptime(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });

        deviceNameRow.add_child(this._deviceWithUptime);

        deviceInfoUser.add_child(deviceLabel);
        deviceInfoUser.add_child(deviceNameRow);

        profileRow.add_child(deviceInfoUser);

        top1_LeftColumn.add_child(profileRow);

        // ========== DEVICE IP ========== //
        const ipRow = new St.BoxLayout({ vertical: false });

        ipRow.add_child(new St.Label({
            text: 'IP Address : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        }));
        ipRow.add_child(new St.Label({
            text: this._getLanIPAddress(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 14px;`
        }));

        top2_LeftColumn.add_child(ipRow);

        // ========== DEVICE WIFI ========== //
        const { download, upload } = this._getNetworkSpeed();

        const wifiLabel = new St.Label({
            text: 'WiFi ssid : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._wifiSpeedLabel = new St.Label({
            text: `${this._getWifiSSID()} ↓ ${download} ↑ ${upload}`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 14px;`
        });
        const wifiRow = new St.BoxLayout({ vertical: false });

        wifiRow.add_child(wifiLabel);
        wifiRow.add_child(this._wifiSpeedLabel);
        top2_LeftColumn.add_child(wifiRow);

        // ========== RIGHT COLUMN ========== //
        rightColumn.add_child(topRightColumn);
        rightColumn.add_child(top1_RightColumn);
        rightColumn.add_child(space1_RightColumn);
        rightColumn.add_child(top2_RightColumn);
        rightColumn.add_child(space2_RightColumn);
        rightColumn.add_child(top3_RightColumn);
        
        // ========== SYSTEM INFO ========== //
        const { osName, osType, kernelVersion } = this._getSystemInfo();

        const device_OS = new St.Label({
            text: `OS : ${osName} [${osType}]`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 18px;`,
            x_align: Clutter.ActorAlign.START,
        });

        const device_Kernel = new St.Label({
            text: `Kernel : Linux ${kernelVersion}`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 16px;`,
            x_align: Clutter.ActorAlign.START,
        });
        
        top1_RightColumn.add_child(device_OS);
        top1_RightColumn.add_child(device_Kernel);

        // ========== DEVICE CPU ========== //
        const {cpu, core, coreSpeeds} = this._getCPUInfo();

        const cpuHead = new St.Label({
            text: 'Processor',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        const cpuName = new St.Label({
            text: `${cpu} x ${core}`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 14px;`
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
        
        coreSpeeds.forEach((line) => {
            const label = new St.Label({
                text: line,
                style: 'font-weight:bold; font-size:11px;',
                x_expand: true
            });
            this._coreBox.add_child(label);
        });

        top2_RightColumn.add_child(cpuHead);
        top2_RightColumn.add_child(cpuName);
        top2_RightColumn.add_child(cpu_scrollView);

        // ========== DEVICE GPU ========== //
        const gpuHead = new St.Label({
            text: 'Graphics',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        
        this._gpuBox = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true
        });
        
        const gpu_scrollView = new St.ScrollView({
            style_class: 'custom-scroll',
            overlay_scrollbars: true,
            enable_mouse_scrolling: true,
            x_expand: true,
            y_expand: true
        });
        gpu_scrollView.set_child(this._gpuBox);
        
        const gpuLines = this._getCachedGpuInfo().split('\n');
        
        let currentBlock = [];
        gpuLines.forEach((line) => {
            if (line.startsWith('GPU')) {
                if (currentBlock.length > 0) {
                    currentBlock.forEach(blockLine => {
                        const label = new St.Label({
                            text: blockLine,
                            style: 'font-weight: bold; font-size: 11px;',
                            x_expand: true
                        });
                        this._gpuBox.add_child(label);
                    });

                    this._gpuBox.add_child(new St.Label({ text: ' ', style: 'font-size: 8px;' }));
                }

                currentBlock = [line];
            } else if (line.trim() !== '') {
                currentBlock.push(line);
            }
        });

        if (currentBlock.length > 0) {
            currentBlock.forEach(blockLine => {
                const label = new St.Label({
                    text: blockLine,
                    style: 'font-weight: bold; font-size: 11px;',
                    x_expand: true
                });
                this._gpuBox.add_child(label);
            });
        }
        
        top3_RightColumn.add_child(gpuHead);
        top3_RightColumn.add_child(gpu_scrollView);           

        // ========== END UI ========== //
        this._main_screen.set_size(popupWidth, popupHeight);

        Main.layoutManager.addChrome(this._main_screen, {
            trackFullscreen: true,
        });

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._main_screen) return GLib.SOURCE_REMOVE;

            const [_, natWidth] = this._main_screen.get_preferred_width(-1);
            const [__, natHeight] = this._main_screen.get_preferred_height(-1);
            const x = Math.floor((monitor.width - natWidth) / 2) + monitor.x;
            const y = Math.floor((monitor.height - natHeight) / 2) + monitor.y;

            this._main_screen.set_position(x, y);
            return GLib.SOURCE_REMOVE;
        });

        this._updateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._updateFrequency, () => {
            this._updateUptime();
            this._updateWifiSpeed();
            this._updateCPUInfo();
            this._updateGpuData();
            return true;
        });
    }

    _destroyMainScreen() {
        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
            this._updateTimeoutId = null;
        }
        
        if (this._main_screen) {
            Main.layoutManager.removeChrome(this._main_screen);
            this._main_screen.destroy();
            this._main_screen = null;
        }
    }

    disable() {
        this._destroyMainScreen();
        
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