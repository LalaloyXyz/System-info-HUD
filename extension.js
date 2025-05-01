import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export default class mainShow extends Extension {
    enable() {
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

    // ========== UI COMPONENT HELPERS ========== //
    _createColumn_width(width, backgroundColor = 'transparent') {
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${backgroundColor}; border: 0px solid white;`,
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        column.set_width(width);
        return column;
    }

    _createColumn_height(height, backgroundColor = 'transparent') {
        const column = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${backgroundColor}; border: 0px solid white;`,
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
    _updateUptime() {
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/uptime');
            if (ok) {
                const uptimeSeconds = parseFloat(imports.byteArray.toString(contents).split(' ')[0]);
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                const seconds = Math.floor(uptimeSeconds % 60);

                const DeviceName = GLib.get_host_name();
                if (this._deviceWithUptime) {
                    this._deviceWithUptime.text = `${DeviceName} : ${hours}H ${minutes}M ${seconds}s`;
                }
            }
        } catch (e) {
            log('Failed to update uptime: ' + e.message);
        }

        return true;
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
    
            if (this._lastTimestamp && activeIface === this._lastIface) {
                const dt = (now - this._lastTimestamp) / 1000;
                down = this._formatSpeed((rx - this._lastRx) / dt);
                up = this._formatSpeed((tx - this._lastTx) / dt);
            }
    
            this._lastIface = activeIface;
            this._lastRx = rx;
            this._lastTx = tx;
            this._lastTimestamp = now;
    
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
                let cpuName = `core-${String(pid).padStart(2, '0')}    [`;
                let speed = coreSpeeds[pid] || "N/A";
                let coreId = coreIdMap[pid] || "0";
                let temp = coreTemps[coreId] || "N/A";

                let speedEmoji = "⬜";
                if (speed >= 3000) speedEmoji = "🟥";
                else if (speed >= 2250) speedEmoji = "🟧";
                else if (speed >= 1500) speedEmoji = "🟨";
                else if (speed >= 750) speedEmoji = "🟩";
                else speedEmoji = "⬜️";
    
                let tempEmoji = "⚪";
                if (temp !== "N/A") {
                    let tempNum = parseFloat(temp);
                    if (tempNum >= 80) tempEmoji = "🔴";
                    else if (tempNum >= 70) tempEmoji = "🟠";
                    else if (tempNum >= 60) tempEmoji = "🟡";
                    else if (tempNum >= 50) tempEmoji = "🟢";
                    else if (tempNum >= 40) tempEmoji = "⚪️";
                    else tempEmoji = "🔵";
                }
    
                let speedStr = `${speed} MHz`.padEnd(10);
                let tempStr = `]    ${tempEmoji} temp   [ ${temp}°C ]`;
    
                if (speed < 1000) result.push(`${speedEmoji} ${cpuName}       ${speedStr}   ${tempStr}`);
                             else result.push(`${speedEmoji} ${cpuName}     ${speedStr}    ${tempStr}`);
            });
    
            return {
                cpu: modelName,
                core: processorIds.length,
                coreSpeeds: result.join('\n')
            };
    
        } catch (e) {
            logError(e);
        }
    }

    _updateCPUInfo() {
        let cpuInfo = this._getCPUInfo();
        if (cpuInfo) {
            this._cpuCore.text = cpuInfo.coreSpeeds;
        }
        return true;
    }

    // ========== MAIN SCREEN UI ========== //
    _showMainScreen() {
        const monitor = Main.layoutManager.primaryMonitor;
        const popupWidth = Math.floor(monitor.width * 0.4);
        const popupHeight = Math.floor(monitor.height * 0.4);

        this._main_screen = new St.BoxLayout({
            vertical: false,
            style: 'background-color: #212121; border-radius: 40px;',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        // ========== CREATE COLUMN ========== //
        const frontColumn = this._createColumn_width(Math.floor(popupWidth * 0.05));
        const leftColumn = this._createColumn_width(Math.floor(popupWidth * 0.50));
        const rightColumn = this._createColumn_width(Math.floor(popupWidth * 0.45));

        // ========== CREATE LEFT ========== //
        const topLeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.06));
        const top1_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.18));
        const space1_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.05));
        const top2_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.1));
        const space2_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.025));
        const top3_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.585));

        // ========== CREATE RIGHT ========== //
        const topRightColumn = this._createColumn_height(Math.floor(popupHeight * 0.12));
        const top1_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.12));

        this._enableDrag(this._main_screen);

        this._main_screen.add_child(frontColumn);
        this._main_screen.add_child(leftColumn);
        this._main_screen.add_child(rightColumn);

        // ========== LEFT COLUMN ========== //
        leftColumn.add_child(topLeftColumn);
        leftColumn.add_child(top1_LeftColumn);
        leftColumn.add_child(space1_LeftColumn);
        leftColumn.add_child(top2_LeftColumn);
        leftColumn.add_child(space2_LeftColumn);
        leftColumn.add_child(top3_LeftColumn);

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
                border: 3px solid white;
            `,
            clip_to_allocation: true,
        });

        profileRow.add_child(profileBin);

        const Left_label_1 = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.END,
            style: 'padding-left: 20px;',
        });

        const deviceLabel = new St.Label({
            text: `Device name`,
            style: 'color: white; font-weight: bold; font-size: 14px;',
        });

        const deviceNameRow = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        this._deviceWithUptime = new St.Label({
            text: 'Loading uptime...',
            style: 'color: white; font-weight: bold; font-size: 18px;',
            x_align: Clutter.ActorAlign.START,
        });

        deviceNameRow.add_child(this._deviceWithUptime);

        Left_label_1.add_child(deviceLabel);
        Left_label_1.add_child(deviceNameRow);

        profileRow.add_child(Left_label_1);

        top1_LeftColumn.add_child(profileRow);

        // ========== DEVICE IP ========== //
        const ipRow = new St.BoxLayout({ vertical: false });

        ipRow.add_child(new St.Label({
            text: 'IP Address : ',
            style: 'color:rgb(141,141,141); font-weight:bold; font-size:13px;'
        }));
        ipRow.add_child(new St.Label({
            text: this._getLanIPAddress(),
            style: 'color:white; font-weight:bold; font-size:14px;'
        }));

        top2_LeftColumn.add_child(ipRow);

        // ========== DEVICE WIFI ========== //
        const { download, upload } = this._getNetworkSpeed();

        const wifiLabel = new St.Label({
            text: 'WiFi ssid : ',
            style: 'color:rgb(141,141,141); font-weight:bold; font-size:13px;'
        });
        this._wifiSpeedLabel = new St.Label({
            text: `${this._getWifiSSID()} ↓ ${download} ↑ ${upload}`,
            style: 'color:white; font-weight:bold; font-size:14px;'
        });
        const wifiRow = new St.BoxLayout({ vertical: false });

        wifiRow.add_child(wifiLabel);
        wifiRow.add_child(this._wifiSpeedLabel);
        top2_LeftColumn.add_child(wifiRow);

        // ========== DEVICE CPU ========== //
        const {cpu, core, coreSpeeds} = this._getCPUInfo();

        const cpuHead = new St.Label({
            text: 'Processor',
            style: 'color:rgb(141,141,141); font-weight:bold; font-size:13px;'
        });
        const cpuName = new St.Label({
            text: `${cpu} x${core}`,
            style: 'color: white; font-weight:bold; font-size:14px;'
        });
        this._cpuCore = new St.Label({
            text: `${coreSpeeds}`,
            style: 'font:monospace; color: white; font-weight:bold; font-size:11px;'
        });

        top3_LeftColumn.add_child(cpuHead);
        top3_LeftColumn.add_child(cpuName);
        top3_LeftColumn.add_child(this._cpuCore);

        // ========== RIGHT COLUMN ========== //
        rightColumn.add_child(topRightColumn);
        rightColumn.add_child(top1_RightColumn);
        
        // ========== SYSTEM INFO ========== //
        const { osName, osType, kernelVersion } = this._getSystemInfo();

        const device_OS = new St.Label({
            text: `OS : ${osName} [${osType}]`,
            style: 'color: white; font-weight: bold; font-size: 18px;',
            x_align: Clutter.ActorAlign.START,
        });

        const device_Kernel = new St.Label({
            text: `Kernel : ${kernelVersion}`,
            style: 'color: white; font-weight: bold; font-size: 16px;',
            x_align: Clutter.ActorAlign.START,
        });
        
        top1_RightColumn.add_child(device_OS);
        top1_RightColumn.add_child(device_Kernel);

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

        this._uptimeTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._updateUptime());
        this._wifiSpeedTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._updateWifiSpeed());
        this._cpuUpdateTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._updateCPUInfo());
    }

    _destroyMainScreen() {
        if (this._uptimeTimeoutId) {
            GLib.source_remove(this._uptimeTimeoutId);
            this._uptimeTimeoutId = null;
        }
        if (this._wifiSpeedTimeoutId) {
            GLib.source_remove(this._wifiSpeedTimeoutId);
            this._wifiSpeedTimeoutId = null;
        }
        if (this._cpuUpdateTimeoutId) {
            GLib.source_remove(this._cpuUpdateTimeoutId);
            this._cpuUpdateTimeoutId = null;
        }
        if (this._main_screen) {
            Main.layoutManager.removeChrome(this._main_screen);
            this._main_screen.destroy();
            this._main_screen = null;
        }
    }

    disable() {
        this._destroyMainScreen();
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
