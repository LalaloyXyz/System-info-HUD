import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';


const ByteArray = imports.byteArray;

const getStatusEmoji = (value, thresholds) => {
    if (value >= thresholds[0]) return "🟥";
    if (value >= thresholds[1]) return "🟧";
    if (value >= thresholds[2]) return "🟨";
    if (value >= thresholds[3]) return "🟩";
    if (thresholds.length > 4 && value >= thresholds[4]) return "⬜️";
    if (thresholds.length > 5) return "🟦";
    return "⬜️";
};

export default class mainShow extends Extension {
    enable() {
        this._cache = {
            gpuInfo: { data: null, timestamp: 0 },
            cpuInfo: { data: null, timestamp: 0 },
            memoryInfo: { data: null, timestamp: 0 },
            storageInfo: { data: null, timestamp: 0 },
            networkInterface: { lastIface: null, lastRx: 0, lastTx: 0, lastTimestamp: 0 },
            systemInfo: { data: null, timestamp: 0 },
            lanIP: { data: null, timestamp: 0 },
            publicIP: { data: null, timestamp: 0 },
            wifiSSID: { data: null, timestamp: 0 },
            powerInfo: { data: null, timestamp: 0 }
        };

        this._cacheTTL = {
            gpuInfo: 5000,       // 5 s
            cpuInfo: 2000,       // 2 s
            memoryInfo: 3000,    // 3 s
            storageInfo: 60000,  // 1 m
            systemInfo: 600000,  // 10 m
            lanIP: 60000,        // 1 m
            publicIP: 120000,    // 2 m
            wifiSSID: 10000,     // 10 s
            powerInfo: 5000,     // 5 s
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
            text: `Info`,
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
            isDark: isDarkTheme
        };

        return this._cache.themeColors;
    }
    
    _onThemeChanged() {
        this._updateThemeColors();

        if (this._main_screen) {
            this._destroyMainScreen();
            this._showMainScreen();
        }
    }

    // ========== UI COMPONENT HELPERS ========== // ================================================================================================================================//
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

    // ========== DATA FETCHERS ========== // =======================================================================================================================================//

    // ========== UP TIME ========== //
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

    // ========== SYSTEM ========== //
    _getSystemInfo() {
        const now = Date.now();
        if (this._cache.systemInfo.data && 
            now - this._cache.systemInfo.timestamp < this._cacheTTL.systemInfo) {
            return this._cache.systemInfo.data;
        }

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
    
        const result = { osName, osType, kernelVersion };
        
        this._cache.systemInfo = {
            data: result,
            timestamp: now
        };
        
        return result;
    }
    
    // ========== IP ========== //
     _getLocalIP() {
        const now = Date.now();
        if (this._cache.lanIP.data && 
            now - this._cache.lanIP.timestamp < this._cacheTTL.lanIP) {
            return this._cache.lanIP.data;
        }

        let local_ip = 'Unknown';
        try {
            const [ok, out] = GLib.spawn_command_line_sync("ip route get 1.1.1.1");
            if (ok) {
                const output = imports.byteArray.toString(out);
                const match = output.match(/src (\d+\.\d+\.\d+\.\d+)/);
                if (match) {
                    local_ip = match[1];
                    this._cache.lanIP = {
                        data: local_ip,
                        timestamp: now
                    };
                }
            }
        } catch (e) {
            log('Failed to get LAN IP: ' + e.message);
        }
        return local_ip;
    }

    _getPublicIP() {
        const now = Date.now();
        if (this._cache.publicIP.data && 
            now - this._cache.publicIP.timestamp < this._cacheTTL.publicIP) {
            return this._cache.publicIP.data;
        }

        try {
            let [ok, stdout, stderr, status] = GLib.spawn_command_line_sync(
                "curl -s https://api.ipify.org"
            );

            if (ok && stdout.length > 0) {
                const ip = ByteArray.toString(stdout).trim();

                this._cache.publicIP = {
                    data: ip,
                    timestamp: Date.now()
                };

                if (this._publicIPLabel)
                    this._publicIPLabel.text = ip;

                return ip;
            }
        } catch (e) {
            log(`Error fetching public IP with curl: ${e.message}`);
        }

        return this._cache.publicIP.data || 'Error';
    }

    _updateIPInfo() {
        if (!this._publicIPLabel || !this._localIPLabel) return true;
        
        const localIP = this._getLocalIP();
        if (this._localIPLabel.text !== localIP) {
            this._localIPLabel.text = localIP;
        }
        
        const publicIP = this._getPublicIP();
        if (this._publicIPLabel.text !== publicIP) {
            this._publicIPLabel.text = publicIP;
        }
        
        return true;
    }

    // ========== SSID ========== //
    _getWifiSSID() {
        const now = Date.now();
        if (this._cache.wifiSSID.data && 
            now - this._cache.wifiSSID.timestamp < this._cacheTTL.wifiSSID) {
            return this._cache.wifiSSID.data;
        }

        try {
            const [ok, out] = GLib.spawn_command_line_sync("iwgetid -r");
            if (ok) {
                const ssid = imports.byteArray.toString(out).trim() || "Not connected";
                
                this._cache.wifiSSID = {
                    data: ssid,
                    timestamp: now
                };
                
                return ssid;
            }
        } catch (e) {
            log('Failed to get SSID: ' + e.message);
        }
        return 'Unknown';
    }    

    // ========== NET SPEED ========== //
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
                if (dt > 0) {
                    down = this._formatSpeed((rx - this._cache.networkInterface.lastRx) / dt);
                    up = this._formatSpeed((tx - this._cache.networkInterface.lastTx) / dt);
                }
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
        if (!this._wifiSpeedLabel) return true;
    
        const { download, upload } = this._getNetworkSpeed();
        const ssid = this._getWifiSSID();
        const newText = `${ssid} ↓ ${download} ↑ ${upload}`;

        if (this._wifiSpeedLabel.text !== newText) {
            this._wifiSpeedLabel.text = newText;
        }   
        return true;
    }

    // ========== CPU ========== //
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
                coreTemps[id] = temp.toFixed(0);
            }
            
            let result = [];
            processorIds.sort((a, b) => parseInt(a) - parseInt(b)).forEach((pid) => {
                let coreName = `Core-${String(pid).padStart(2, '0')}    [`;
                let speed = coreSpeeds[pid] || "N/A";
                let coreId = coreIdMap[pid] || "0";
                let temp = coreTemps[coreId] || "N/A";
                
                let speedEmoji = getStatusEmoji(speed, [3000, 2250, 1500, 750]);
                
                let tempEmoji = "⬜️";
                if (temp !== "N/A") {
                    let tempNum = parseFloat(temp);
                    tempEmoji = getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                }
                
                let speedStr = `${speed} MHz`.padEnd(10);
                let tempStr = `]    ${tempEmoji} Temp   ${temp} °C`;
                
                if (speed < 1000) 
                    result.push(`${speedEmoji} ${coreName}       ${speedStr}   ${tempStr}`);
                else 
                    result.push(`${speedEmoji} ${coreName}     ${speedStr}    ${tempStr}`);
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
        if (!this._coreBox) return true;
    
        const cpuInfo = this._getCachedCPUInfo();
        if (!cpuInfo || !cpuInfo.coreSpeeds) return true;

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
        return true;
    }  
    
    // ========== GPU ========== //
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
                        let loadEmoji = getStatusEmoji(load, [80, 60, 50, 40]);
                        
                        let tempEmoji = "⬜️";
                        if (temp !== "N/A") {
                            let tempNum = parseFloat(temp);
                            tempEmoji = getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                        }

                        resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${used}MB / ${total}MB ] [${load}%] ${tempEmoji} Temp ${temp} °C`);
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
                            let loadEmoji = getStatusEmoji(load, [80, 60, 50, 40]);

                            let tempEmoji = "⬜️";
                            if (temp !== "N/A") {
                                let tempNum = parseFloat(temp);
                                tempEmoji = getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                            }

                            resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${Math.round(used)}MB / ${Math.round(total)}MB ] [${load}%] ${tempEmoji} Temp ${temp} °C`);
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
        if (!this._gpuBox) return true;
    
        const gpuInfo = this._getCachedGpuInfo();
        if (!gpuInfo) return true;

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
        else if (existingCount > newCount) {
            for (let i = newCount; i < existingCount; i++) {
                children[i].hide();
            }
        }
        return true;
    }

    // ========== RAM ========== //
    _getCachedMemoryInfo() {
        const now = Date.now();
        if (this._cache.memoryInfo.data && 
            now - this._cache.memoryInfo.timestamp < this._cacheTTL.memoryInfo) {
            return this._cache.memoryInfo.data;
        }

        const memoryInfo = this._getMemoryInfo();
        this._cache.memoryInfo = {
            data: memoryInfo,
            timestamp: now
        };
        return memoryInfo;
    }

    _getMemoryInfo() {
        const meminfo = GLib.file_get_contents('/proc/meminfo')[1].toString();
    
        const toKB = key => {
            const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\skB`, 'm'));
            return match ? parseInt(match[1], 10) : 0;
        };
    
        const total = toKB('MemTotal');
        const free = toKB('MemFree');
        const buffers = toKB('Buffers');
        const cached = toKB('Cached');
        const sreclaimable = toKB('SReclaimable');
        const shmem = toKB('Shmem');
    
        const used = total - free - buffers - cached - sreclaimable + shmem;
    
        const totalGB = (total / 1024 / 1024).toFixed(1);
        const usedGB = (used / 1024 / 1024).toFixed(1);
        const cacheGB = ((cached + sreclaimable) / 1024 / 1024).toFixed(1);
        const percentNum = ((used / total) * 100);
        const percent = percentNum.toFixed(1);
    
        let loadEmoji = getStatusEmoji(percentNum, [80, 60, 50, 40]);
    
        return {
            max: `${totalGB} GB`,
            use: `${usedGB}`,
            percent: `${percent}%`,
            cache: `${cacheGB} GB`,
            loadEmoji: loadEmoji
        };
    }      

    _updateMemoryInfo() {
        if (!this._memoryUse || !this._memoryCache) return true;
    
        const memoryInfo = this._getCachedMemoryInfo();
        const { use, max, percent, cache, loadEmoji } = memoryInfo;
        
        const newUseText = `${loadEmoji} [ ${use} / ${max} ] [${percent}]`;
        const newCacheText = `Cache ${cache}`;

        if (this._memoryUse.text !== newUseText) {
            this._memoryUse.text = newUseText;
        }
        
        if (this._memoryCache.text !== newCacheText) {
            this._memoryCache.text = newCacheText;
        }
        return true;
    } 

    // ========== STORAGE ========== //
    _getCachedStorageInfo() {
        const now = Date.now();
        if (this._cache.storageInfo.data && 
            now - this._cache.storageInfo.timestamp < this._cacheTTL.storageInfo) {
            return this._cache.storageInfo.data;
        }

        const storageInfo = this._getStorageInfo();
        this._cache.storageInfo = {
            data: storageInfo,
            timestamp: now
        };
        return storageInfo;
    }

    _getStorageInfo() {
        let [ok, out, err, exit] = GLib.spawn_command_line_sync("df -h");
        if (!ok || !out) return "Disk info unavailable";

        const output = ByteArray.toString(out);
        const lines = output.trim().split("\n").slice(1);

        let result = [];

        for (let line of lines) {
            line = line.trim();
            const parts = line.split(/\s+/);
            if (parts.length >= 6) {
                const filesystem = parts[0];
                const size = parts[1];
                const used = parts[2];
                const available = parts[3];
                const use_percent = parts[4];
                const mount = parts[5];

                let percent = parseInt(use_percent.replace('%', ''));
                let loadEmoji = getStatusEmoji(percent, [80, 60, 50, 40]);

                if (!filesystem.startsWith("/dev/")) continue;

                result.push(`- ${filesystem} (  ${mount}  )\n${loadEmoji} [ ${used} / ${size} ] [${use_percent}] Avail ${available}\n`);
            }
        }

        return result.length > 0 ? result.join("\n") : "No real devices found";
    }

    _updateStorageInfo() {
        if (!this._storageBox) return true;
        
        const storageInfo = this._getCachedStorageInfo();
        const storageInfoLines = typeof storageInfo === 'string' 
            ? storageInfo.split('\n') 
            : storageInfo.flatMap(entry => entry.split('\n'));
        
        const children = this._storageBox.get_children();
        const existingCount = children.length;
        const newCount = storageInfoLines.length;
        
        for (let i = 0; i < Math.min(existingCount, newCount); i++) {
            if (children[i].text !== storageInfoLines[i]) {
                children[i].text = storageInfoLines[i];
            }
        }
        
        if (existingCount < newCount) {
            for (let i = existingCount; i < newCount; i++) {
                const label = new St.Label({
                    text: storageInfoLines[i],
                    style: 'font-weight: bold; font-size: 11px;',
                    x_expand: true
                });
                this._storageBox.add_child(label);
            }
        }
        else if (existingCount > newCount) {
            for (let i = newCount; i < existingCount; i++) {
                children[i].hide();
            }
        }
        return true;
    }

    // ========== POWER ========== //
    _getCachedPowerInfo() {
        const now = Date.now();
        if (this._cache.powerInfo.data && 
            now - this._cache.powerInfo.timestamp < this._cacheTTL.powerInfo) {
            return this._cache.powerInfo.data;
        }

        const powerInfo = this._getPowerInfo();
        this._cache.powerInfo = {
            data: powerInfo,
            timestamp: now
        };
        return powerInfo;
    }

    _getPowerInfo() {
        try {
            let [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                'bash -c "upower -i $(upower -e | grep BAT) | grep -E \\"state|percentage|time|energy-rate\\""'
            );
            
            if (!success || exitCode !== 0) {
                return "Power data unavailable";
            }
            
            let output = new TextDecoder().decode(stdout);
            
            let state = "Unknown";
            let percentage = "";
            let wattage = "";
            let time = "";
            
            let stateMatch = output.match(/state:\s+(\w+)/i);
            if (stateMatch && stateMatch[1]) {
                state = stateMatch[1].charAt(0).toUpperCase() + stateMatch[1].slice(1);
            }
            
            let percentMatch = output.match(/percentage:\s+(\d+(\.\d+)?)%/i);
            if (percentMatch && percentMatch[1]) {
                percentage = parseFloat(percentMatch[1]).toFixed(1);
            }
            
            let rateMatch = output.match(/energy-rate:\s+(\d+(\.\d+)?)\s+W/i);
            if (rateMatch && rateMatch[1]) {
                wattage = parseFloat(rateMatch[1]).toFixed(2);
            }

            let timeMatch = output.match(/time to (empty|full):\s+(.+)/i);
            if (timeMatch) {
                time = timeMatch[2].trim();
            }
            
            return `${percentage}% | ${wattage}W\n${state}${time ? " | " + time : ""}`;
        } catch (e) {
            logError(e);
            return "Error reading power data";
        }
    }

    _updatePowerInfo() {
        if (!this._memoryUse || !this._memoryCache) return true;
    
        const memoryInfo = this._getCachedPowerInfo();
        if (this._powerShow.text !== memoryInfo) {
            this._powerShow.text = memoryInfo;
        }
        return true;
    } 
        
    // ========== MAIN SCREEN UI ========== // ======================================================================================================================================//
    _showMainScreen() {
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

        // ========== CREATE COLUMN ========== // 
        const frontColumn = this._createColumn_width(Math.floor(popupWidth * 0.05));
        const leftColumn = this._createColumn_width(Math.floor(popupWidth * 0.48));
        const rightColumn = this._createColumn_width(Math.floor(popupWidth * 0.42));
        const backColumn = this._createColumn_width(Math.floor(popupWidth * 0.05));

        // ========== CREATE LEFT ========== //
        const space0_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.06));
        const deviceInfoUser_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.18));
        const space1_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.05));
        const ipAndWiFi_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.12));
        const space2_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.025));
        const Memory_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.12));
        const space3_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.025));
        const Storage_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.24));
        const space4_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.005));
        const Power_LeftColumn = this._createColumn_height(Math.floor(popupHeight * 0.1));

        // ========== CREATE RIGHT ========== //
        const space0_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.14));
        const OS_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.10));
        const space1_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.05));
        const Processor_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.35));
        const space2_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.045));
        const Graphics_RightColumn = this._createColumn_height(Math.floor(popupHeight * 0.22));

        // ========== CREATE END ========== //
        const topEndColumn = this._createColumn_height(Math.floor(popupHeight * 0.1));

        this._enableDrag(leftColumn);
        this._enableDrag(rightColumn);

        this._main_screen.add_child(frontColumn);
        this._main_screen.add_child(leftColumn);
        this._main_screen.add_child(rightColumn);
        this._main_screen.add_child(backColumn);

        // ========== LEFT COLUMN ========== // =====================================================================================================================================//
        leftColumn.add_child(space0_LeftColumn);
        leftColumn.add_child(deviceInfoUser_LeftColumn);
        leftColumn.add_child(space1_LeftColumn);
        leftColumn.add_child(ipAndWiFi_LeftColumn);
        leftColumn.add_child(space2_LeftColumn);
        leftColumn.add_child(Memory_LeftColumn);
        leftColumn.add_child(space3_LeftColumn);
        leftColumn.add_child(Storage_LeftColumn);
        leftColumn.add_child(space4_LeftColumn);
        leftColumn.add_child(Power_LeftColumn);

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

        deviceInfoUser_LeftColumn.add_child(profileRow);

        // ========== DEVICE WIFI ========== //
        const { download, upload } = this._getNetworkSpeed();

        const wifiLabel = new St.Label({
            text: 'Wi-Fi : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });
        this._wifiSpeedLabel = new St.Label({
            text: `${this._getWifiSSID()} ↓ ${download} ↑ ${upload}`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 13px;`
        });
        const wifiRow = new St.BoxLayout({ vertical: false });

        wifiRow.add_child(wifiLabel);
        wifiRow.add_child(this._wifiSpeedLabel);
        ipAndWiFi_LeftColumn.add_child(wifiRow);

        // ========== IP ========== //
        const publicipRow = new St.BoxLayout({ vertical: false });
        const localipRow = new St.BoxLayout({ vertical: false });

        // Public IP Label
        publicipRow.add_child(new St.Label({
            text: 'Public IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`
        }));
        const publicIPLabel = new St.Label({
            text: this._getPublicIP(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });
        publicipRow.add_child(publicIPLabel);

        // Local IP Label
        localipRow.add_child(new St.Label({
            text: 'Local IP : ',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`
        }));
        localipRow.add_child(new St.Label({
            text: this._getLocalIP(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        }));

        ipAndWiFi_LeftColumn.add_child(publicipRow);
        ipAndWiFi_LeftColumn.add_child(localipRow);

         // ========== DEVICE MEMORY ========== //
        const { max, use, percent, cache, loadEmoji} = this._getMemoryInfo();
        const memoryHead = new St.Label({
            text: 'Memory',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });

        this._memoryUse = new St.Label({
            text: `${loadEmoji} [ ${use} / ${max} ] [${percent}]`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });

        this._memoryCache = new St.Label({
            text: `Cache ${cache}`,
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });

        Memory_LeftColumn.add_child(memoryHead);
        Memory_LeftColumn.add_child(this._memoryUse);
        Memory_LeftColumn.add_child(this._memoryCache);

        // ========== DEVICE STORAGE ========== //
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

        const storageInfoLines = this._getStorageInfo().split('\n');

        storageInfoLines.forEach((line) => {
            const label = new St.Label({
                text: line,
                style: 'font-weight: bold; font-size: 11px;',
                x_expand: true
            });
            this._storageBox.add_child(label);
        });

        Storage_LeftColumn.add_child(storageHead);
        Storage_LeftColumn.add_child(storage_scrollView);

        // ========== DEVICE POWER ========== //
        const powerHead = new St.Label({
            text: 'Power',
            style: `color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`
        });

        this._powerShow = new St.Label({
            text: this._getPowerInfo(),
            style: `color: ${themeColors.text}; font-weight: bold; font-size: 12px;`
        });

        Power_LeftColumn.add_child(powerHead);
        Power_LeftColumn.add_child(this._powerShow);

        // ========== RIGHT COLUMN ========== // ====================================================================================================================================//
        rightColumn.add_child(space0_RightColumn);
        rightColumn.add_child(OS_RightColumn);
        rightColumn.add_child(space1_RightColumn);
        rightColumn.add_child(Processor_RightColumn);
        rightColumn.add_child(space2_RightColumn);
        rightColumn.add_child(Graphics_RightColumn);
        
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
        
        OS_RightColumn.add_child(device_OS);
        OS_RightColumn.add_child(device_Kernel);

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

        Processor_RightColumn.add_child(cpuHead);
        Processor_RightColumn.add_child(cpuName);
        Processor_RightColumn.add_child(cpu_scrollView);

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
                    this._gpuBox.add_child(new St.Label({ text: ' ', style: 'font-size: 11px;' }));
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
        
        Graphics_RightColumn.add_child(gpuHead);
        Graphics_RightColumn.add_child(gpu_scrollView);           

        // ========== BACK COLUMN ========== // =====================================================================================================================================//
        backColumn.add_child(topEndColumn);

        // ========== EXIT ========== //
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
            this._destroyMainScreen();
        });

        topEndColumn.add_child(closeButton);

        // ========== END UI ========== // ==========================================================================================================================================//
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
            this._updateIPInfo();
            this._updateWifiSpeed();
            this._updateCPUInfo();
            this._updateGpuData();
            this._updateMemoryInfo();
            this._updateStorageInfo();
            this._updatePowerInfo();
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