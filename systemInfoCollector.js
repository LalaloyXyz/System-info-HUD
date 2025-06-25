import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

export class SystemInfoCollector {
    constructor() {
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
            powerInfo: { data: null, timestamp: 0 },
            uptime: { data: null, timestamp: 0 },
            networkSpeed: { data: null, timestamp: 0 }
        };

        this._cacheTTL = {
            gpuInfo: 2000,       // 2 s
            cpuInfo: 1000,       // 1 s
            memoryInfo: 3000,    // 3 s
            storageInfo: 60000,  // 1 m
            systemInfo: 600000,  // 10 m
            lanIP: 60000,        // 1 m
            publicIP: 120000,    // 2 m
            wifiSSID: 10000,     // 10 s
            powerInfo: 5000,     // 5 s
            uptime: 500,        // 0.5 s
            networkSpeed: 1000   // 1 s
        };
    }

    _getStatusEmoji(value, thresholds) {
        if (value >= thresholds[0]) return "🟥";
        if (value >= thresholds[1]) return "🟧";
        if (value >= thresholds[2]) return "🟨";
        if (value >= thresholds[3]) return "🟩";
        if (thresholds.length > 4 && value >= thresholds[4]) return "⬜️";
        if (thresholds.length > 5) return "🟦";
        return "⬜️";
    }

    async getSystemInfo() {
        const now = Date.now();
        if (this._cache.systemInfo.data && 
            now - this._cache.systemInfo.timestamp < this._cacheTTL.systemInfo) {
            return this._cache.systemInfo.data;
        }

        let osName = 'Unknown OS';
        try {
            const subprocess = new Gio.Subprocess({
                argv: ['cat', '/etc/os-release'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const lines = stdout.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('PRETTY_NAME=')) {
                    osName = line.split('=')[1].replace(/"/g, '');
                    break;
                }
            }
        } catch (e) {
            console.error('Failed to read /etc/os-release:', e);
        }

        const osType = GLib.SIZEOF_VOID_P === 8 ? 
            (GLib.getenv('PROCESSOR_ARCHITECTURE')?.includes('arm') ? 'ARM64' : 'x86_64') : 
            (GLib.getenv('PROCESSOR_ARCHITECTURE')?.includes('arm') ? 'ARM' : 'x86');
        let kernelVersion = 'Unknown Kernel';
        
        try {
            const subprocess = new Gio.Subprocess({
                argv: ['uname', '-r'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            
            kernelVersion = stdout.toString().trim();
        } catch (e) {
            console.error('Failed to get kernel version:', e);
        }

        const result = { osName, osType, kernelVersion };
        
        this._cache.systemInfo = {
            data: result,
            timestamp: now
        };
        
        return result;
    }

    async getUptime() {
        const now = Date.now();
        if (this._cache.uptime.data && 
            now - this._cache.uptime.timestamp < this._cacheTTL.uptime) {
            return this._cache.uptime.data;
        }

        try {
            const subprocess = new Gio.Subprocess({
                argv: ['cat', '/proc/uptime'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const uptimeSeconds = parseFloat(stdout.toString().split(' ')[0]);
            const days = Math.floor(uptimeSeconds / 86400);
            const hours = Math.floor((uptimeSeconds % 86400) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = Math.floor(uptimeSeconds % 60);

            const deviceName = GLib.get_host_name();
            const result = `${deviceName} : ${days}d ${hours}h ${minutes}m ${seconds}s`;
            
            this._cache.uptime = {
                data: result,
                timestamp: now
            };
            
            return result;
        } catch (e) {
            console.error('Failed to get uptime:', e);
        }
        return 'Unknown uptime';
    }

    async getLocalIP() {
        const now = Date.now();
        if (this._cache.lanIP.data && 
            now - this._cache.lanIP.timestamp < this._cacheTTL.lanIP) {
            return this._cache.lanIP.data;
        }

        try {
            const subprocess = new Gio.Subprocess({
                argv: ['ip', 'route', 'get', '1.1.1.1'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const output = stdout.toString();
            const match = output.match(/src (\d+\.\d+\.\d+\.\d+)/);
            if (match) {
                const local_ip = match[1];
                this._cache.lanIP = {
                    data: local_ip,
                    timestamp: now
                };
                return local_ip;
            }
        } catch (e) {
            console.error('Failed to get LAN IP:', e);
        }
        return 'Unknown';
    }

    async getPublicIP() {
        const now = Date.now();
        if (this._cache.publicIP.data && 
            now - this._cache.publicIP.timestamp < this._cacheTTL.publicIP) {
            return this._cache.publicIP.data;
        }

        try {
            const session = new Soup.Session();
            const message = Soup.Message.new('GET', 'https://api.ipify.org');
            
            const response = await new Promise((resolve, reject) => {
                session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
                    try {
                        const bytes = session.send_and_read_finish(res);
                        resolve(bytes ? bytes.get_data() : null);
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (response) {
                const decoder = new TextDecoder();
                const ip = decoder.decode(response).trim();
                this._cache.publicIP = {
                    data: ip,
                    timestamp: now
                };
                return ip;
            }
        } catch (e) {
            console.error('Failed to get public IP:', e);
        }
        return 'Unknown';
    }

    async getWifiSSID() {
        const now = Date.now();
        if (this._cache.wifiSSID.data && 
            now - this._cache.wifiSSID.timestamp < this._cacheTTL.wifiSSID) {
            return this._cache.wifiSSID.data;
        }

        try {
            const subprocess = new Gio.Subprocess({
                argv: ['iwgetid', '-r'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const ssid = stdout.toString().trim() || "Not connected";
            this._cache.wifiSSID = {
                data: ssid,
                timestamp: now
            };
            return ssid;
        } catch (e) {
            console.error('Failed to get SSID:', e);
        }
        return 'Unknown';
    }

    async getNetworkSpeed() {
        const now = Date.now();
        if (this._cache.networkSpeed.data && 
            now - this._cache.networkSpeed.timestamp < this._cacheTTL.networkSpeed) {
            return this._cache.networkSpeed.data;
        }
    
        try {
            const subprocess = new Gio.Subprocess({
                argv: ['cat', '/proc/net/dev'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
    
            const lines = stdout.toString().split('\n').slice(2);
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
    
            let down = '0', up = '0';
    
            if (!this._cache.networkInterface.lastTimestamp) {
                this._cache.networkInterface = {
                    lastIface: activeIface,
                    lastRx: rx,
                    lastTx: tx,
                    lastTimestamp: now
                };
            } else if (activeIface === this._cache.networkInterface.lastIface) {
                const dt = (now - this._cache.networkInterface.lastTimestamp) / 1000;
                if (dt > 0) {
                    const rxDiff = rx - this._cache.networkInterface.lastRx;
                    const txDiff = tx - this._cache.networkInterface.lastTx;
                    
                    const rxSpeed = rxDiff / dt;
                    const txSpeed = txDiff / dt;
                    
                    down = this._formatSpeed(rxSpeed);
                    up = this._formatSpeed(txSpeed);
                }
            }
    
            this._cache.networkInterface = {
                lastIface: activeIface,
                lastRx: rx,
                lastTx: tx,
                lastTimestamp: now
            };
            
            const result = { download: down, upload: up };
            this._cache.networkSpeed = {
                data: result,
                timestamp: now
            };
            
            return result;
        } catch (e) {
            console.error('NetSpeed error:', e);
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

    async getCPUInfo() {
        const now = Date.now();
        if (this._cache.cpuInfo.data && 
            now - this._cache.cpuInfo.timestamp < this._cacheTTL.cpuInfo) {
            return this._cache.cpuInfo.data;
        }
    
        try {
            // Get CPU info using lscpu
            const lscpuSubprocess = new Gio.Subprocess({
                argv: ['lscpu'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            lscpuSubprocess.init(null);
            
            const [, lscpuOut] = await new Promise((resolve, reject) => {
                lscpuSubprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
    
            const lscpuText = lscpuOut.toString();
            let modelName = "Unknown CPU";
            const modelNamePatterns = [
                /Model name:\s+(.+)/,   // Intel, AMD, some ARM
                /Model:\s+(.+)/,        // Some AMD/older CPUs
                /CPU:\s+(.+)/,          // Fallback
                /Hardware:\s+(.+)/,     // ARM
            ];
            for (const pattern of modelNamePatterns) {
                const match = lscpuText.match(pattern);
                if (match) {
                    modelName = match[1].trim();
                    break;
                }
            }

            // If still unknown, fallback to /proc/cpuinfo
            if (modelName === "Unknown CPU") {
                // freqText is the output of /proc/cpuinfo
                const cpuinfoMatch = lscpuText.match(/model name\s*:\s*(.+)/);
                if (!cpuinfoMatch) {
                    cpuinfoMatch = lscpuText.match(/Hardware\s*:\s*(.+)/);
                }
                if (cpuinfoMatch) {
                    modelName = cpuinfoMatch[1].trim();
                }
            }
            
            // Core count: try lscpu, then fallback to /proc/cpuinfo
            let coreCount = 0;
            const coresMatch = lscpuText.match(/CPU\(s\):\s+(\d+)/);
            if (coresMatch) {
                coreCount = parseInt(coresMatch[1]);
            } else {
                // Fallback: count "processor" lines in /proc/cpuinfo
                const cpuinfoCores = lscpuText.match(/^processor\s*:/mg);
                if (cpuinfoCores) {
                    coreCount = cpuinfoCores.length;
                }
            }

            // Max frequency: try lscpu, then fallback to /proc/cpuinfo
            let cpumax = 0;
            const cpumaxMatch = lscpuText.match(/CPU max MHz:\s+([\d.]+)/);
            if (cpumaxMatch) {
                cpumax = parseFloat(cpumaxMatch[1]);
            } else {
                // Try /sys for ARM
                try {
                    const cpufreqSubprocess = new Gio.Subprocess({
                        argv: ['cat', '/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq'],
                        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                    });
                    cpufreqSubprocess.init(null);
                    const [, cpufreqOut] = await new Promise((resolve, reject) => {
                        cpufreqSubprocess.communicate_utf8_async(null, null, (proc, res) => {
                            try {
                                resolve(proc.communicate_utf8_finish(res));
                            } catch (e) {
                                reject(e);
                            }
                        });
                    });
                    const freq = parseInt(cpufreqOut.toString().trim());
                    if (!isNaN(freq)) {
                        cpumax = freq / 1000; // kHz to MHz
                    }
                } catch (e) {
                    // ignore
                }
            }

            // Get CPU frequencies and core mapping
            const freqSubprocess = new Gio.Subprocess({
                argv: ['cat', '/proc/cpuinfo'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            freqSubprocess.init(null);
            
            const [, freqOut] = await new Promise((resolve, reject) => {
                freqSubprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
    
            const freqText = freqOut.toString();
            const coreSpeeds = [];
            const processorToCoreMap = {};
            const lines = freqText.split('\n');
            let currentProcessorId = null;
            let isAMD = modelName.toLowerCase().includes('amd');

            // Get current CPU frequencies
            try {
                const freqSubprocess = new Gio.Subprocess({
                    argv: ['sh', '-c', `
                        for i in /sys/devices/system/cpu/cpu*/cpufreq/; do
                            if [ -f "$i/scaling_cur_freq" ]; then
                                cat "$i/scaling_cur_freq";
                            elif [ -f "$i/cpuinfo_cur_freq" ]; then
                                cat "$i/cpuinfo_cur_freq";
                            fi;
                        done | sort -V
                    `],                    
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                });

                freqSubprocess.init(null);
                
                const [, freqOut] = await new Promise((resolve, reject) => {
                    freqSubprocess.communicate_utf8_async(null, null, (proc, res) => {
                        try {
                            resolve(proc.communicate_utf8_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });

                const frequencies = freqOut.toString().trim().split('\n');
                frequencies.forEach((freq, index) => {
                    if (freq) {
                        coreSpeeds[index] = Math.floor(parseInt(freq) / 1000); // Convert kHz to MHz
                    }
                });
            } catch (e) {
                console.error('Error reading CPU frequencies:', e);
            }

            for (let i = 0; i < coreCount; i++) {
                if (!coreSpeeds[i]) {
                    coreSpeeds[i] = 0;
                }
            }

            // Unified core mapping logic for both AMD and Intel
            for (const line of lines) {
                if (line.startsWith('processor')) {
                    currentProcessorId = line.split(':')[1].trim();
                } else if (line.startsWith('core id') && currentProcessorId !== null) {
                    const coreId = line.split(':')[1].trim();
                    processorToCoreMap[currentProcessorId] = coreId;
                }
            }

            const threadsPerCoreMatch = lscpuText.match(/Thread\(s\) per core:\s+(\d+)/);
            const threadsPerCore = threadsPerCoreMatch ? parseInt(threadsPerCoreMatch[1]) : 2;

            if (isAMD && Object.keys(processorToCoreMap).length === 0) {
                for (let i = 0; i < coreCount; i++) {
                    processorToCoreMap[i] = Math.floor(i / threadsPerCore).toString();
                }
            }

            const sensorsSubprocess = new Gio.Subprocess({
                argv: ['sensors'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            sensorsSubprocess.init(null);
            
            const [, sensorOut] = await new Promise((resolve, reject) => {
                sensorsSubprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
    
            const sensorText = sensorOut.toString();
            const coreTemps = {};
            
            // Universal temperature patterns that work for both Intel and AMD
            const tempPatterns = [
                // Core temperature patterns
                /^Core\s+(\d+):\s+\+([\d.]+)°C/mg,           // Standard core temp
                /^Core\s+\d+\s+\(PECI\s+\d+\):\s+\+([\d.]+)°C/mg,  // PECI core temps
                /^CPU\s+Core\s+(\d+):\s+\+([\d.]+)°C/mg,     // Alternative core temp format
                /^Package\s+id\s+\d+:\s+\+([\d.]+)°C/mg,     // Package temp
                /^Package\s+\d+:\s+\+([\d.]+)°C/mg,          // Alternative package temp
                /^CPU\s+Temperature:\s+\+([\d.]+)°C/mg,      // Generic CPU temp
                // AMD specific patterns
                /^Tctl:\s+\+([\d.]+)°C/mg,                   // AMD Tctl
                /^Tdie:\s+\+([\d.]+)°C/mg,                   // AMD Tdie
                /^CPU\s+Tctl\/Tdie:\s+\+([\d.]+)°C/mg,       // Alternative AMD temp
                // Intel specific patterns
                /^Package\s+id\s+0:\s+\+([\d.]+)°C/mg,       // Intel package temp
                /^Core\s+\d+\s+\(PECI\s+\d+\):\s+\+([\d.]+)°C/mg,  // Intel PECI
                /^CPU\s+Package:\s+\+([\d.]+)°C/mg           // Intel package temp
            ];
            
            let globalTemp = null;
            let foundAnyTemp = false;
            
            for (const pattern of tempPatterns) {
                let match;
                pattern.lastIndex = 0;
                
                while ((match = pattern.exec(sensorText)) !== null) {
                    const coreId = match[1] || '0';
                    const temp = parseFloat(match[2] || match[1]);
                    
                    if (match[1]) {
                        coreTemps[coreId] = temp.toFixed(0);
                        foundAnyTemp = true;
                    } else {
                        globalTemp = temp;
                    }
                }
            }
            
            if (!foundAnyTemp && globalTemp) {
                for (let i = 0; i < coreCount; i++) {
                    coreTemps[i.toString()] = globalTemp.toFixed(0);
                }                
            }

            if (Object.keys(coreTemps).length === 0) {
                const anyTempMatch = sensorText.match(/\+([\d.]+)°C/);
                if (anyTempMatch) {
                    const temp = parseFloat(anyTempMatch[1]);
                    for (let i = 0; i < Math.ceil(coreCount / 2); i++) {
                        coreTemps[i.toString()] = temp.toFixed(0);
                    }
                }
            }
    
            const result = [];
            for (let i = 0; i < coreCount; i++) {
                const coreName = `Core-${String(i).padStart(2, '0')}    |`;
                const speed = coreSpeeds[i] || 0;
                const coreload = String(Math.round((coreSpeeds[i] / cpumax) * 100)).padStart(2, '0');
                const physicalCoreId = processorToCoreMap[i] || "0";
                const temp = coreTemps[physicalCoreId] || "N/A";
                
                const speedEmoji = this._getStatusEmoji(coreload, [90, 70, 50, 30]);

                const tempNum = parseFloat(temp);
                const tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                
                const speedStr = `${speed} MHz`.padEnd(10);
                const tempStr = `|  ${coreload}%  |   ${tempEmoji} Temp   ${temp} °C`;
                
                if (speed < 1000) 
                    result.push(`${speedEmoji} ${coreName}       ${speedStr}   ${tempStr}`);
                else 
                    result.push(`${speedEmoji} ${coreName}     ${speedStr}    ${tempStr}`);
            }
    
            const finalResult = {
                cpu: modelName,
                core: coreCount,
                coreSpeeds: result
            };
    
            this._cache.cpuInfo = {
                data: finalResult,
                timestamp: now
            };
    
            return finalResult;
        } catch (e) {
            console.error('Error reading CPU info:', e);
            return {
                cpu: 'Unknown CPU',
                core: 0,
                coreSpeeds: ['Error reading CPU information']
            };
        }
    }

    async getGPUInfo() {
        const now = Date.now();
        if (this._cache.gpuInfo.data && 
            now - this._cache.gpuInfo.timestamp < this._cacheTTL.gpuInfo) {
            return this._cache.gpuInfo.data;
        }

        return new Promise((resolve) => {
            this._getGpuInfoAsync((result) => {
                this._cache.gpuInfo = {
                    data: result,
                    timestamp: now
                };
                resolve(result);
            });
        });
    }

    _getGpuInfoAsync(callback) {
        try {
            let resultList = [];
            let pendingChecks = 3;

            const checkComplete = () => {
                pendingChecks--;
                if (pendingChecks === 0) {
                    const finalResult = resultList.length > 0 
                        ? resultList.join('\n\n') 
                        : 'GPU info not available (sudo or drivers may be required)';
                    callback(finalResult);
                }
            };

            // NVIDIA Check
            let nvidiaSubprocess = new Gio.Subprocess({
                argv: ['which', 'nvidia-smi'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            nvidiaSubprocess.init(null);
            nvidiaSubprocess.communicate_utf8_async(null, null, (subprocess, res) => {
                try {
                    const [, stdout, stderr] = subprocess.communicate_utf8_finish(res);
                    if (stdout.trim() !== "") {
                        let nvidiaInfoSubprocess = new Gio.Subprocess({
                            argv: ['nvidia-smi', '--query-gpu=name,memory.total,memory.used,temperature.gpu', '--format=csv,noheader,nounits'],
                            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                        });
                        nvidiaInfoSubprocess.init(null);
                        nvidiaInfoSubprocess.communicate_utf8_async(null, null, (subprocess, res) => {
                            try {
                                const [, stdout, stderr] = subprocess.communicate_utf8_finish(res);
                                if (stdout) {
                                    let nvidiaData = stdout.trim().split('\n');
                                    nvidiaData.forEach(line => {
                                        let [name, total, used, temp] = line.split(',').map(s => s.trim());

                                        let load = Math.round((parseInt(used) / parseInt(total)) * 100);
                                        let loadEmoji = this._getStatusEmoji(load, [90, 70, 50, 30]);
                                        
                                        let tempEmoji = "⬜️";
                                        if (temp !== "N/A") {
                                            let tempNum = parseFloat(temp);
                                            tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                                        }

                                        resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${used}MB / ${total}MB ] [${load}%] ${tempEmoji} Temp ${temp} °C`);
                                    });
                                }
                                checkComplete();
                            } catch (e) {
                                console.error(`Error processing NVIDIA GPU info: ${e}`);
                                checkComplete();
                            }
                        });
                    } else {
                        checkComplete();
                    }
                } catch (e) {
                    console.error(`Error checking NVIDIA: ${e}`);
                    checkComplete();
                }
            });

            // AMD Check
            let amdSubprocess = new Gio.Subprocess({
                argv: ['which', 'rocm-smi'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            amdSubprocess.init(null);
            amdSubprocess.communicate_utf8_async(null, null, (subprocess, res) => {
                try {
                    const [, stdout, stderr] = subprocess.communicate_utf8_finish(res);
                    if (stdout.trim() !== "") {
                        let amdInfoSubprocess = new Gio.Subprocess({
                            argv: ['rocm-smi', '--showproductname', '--showmemuse', '--json'],
                            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                        });
                        amdInfoSubprocess.init(null);
                        amdInfoSubprocess.communicate_utf8_async(null, null, (subprocess, res) => {
                            try {
                                const [, stdout, stderr] = subprocess.communicate_utf8_finish(res);
                                if (stdout) {
                                    let amdInfo = JSON.parse(stdout.trim());
                                    for (let key in amdInfo) {
                                        let gpu = amdInfo[key];
                                        if (gpu["Card series"]) {
                                            let name = gpu["Card series"];
                                            let used = parseInt(gpu["VRAM Used Memory (B)"]) / (1024 * 1024);
                                            let total = parseInt(gpu["VRAM Total Memory (B)"]) / (1024 * 1024);
                                            let temp = gpu["Temperature (C)"];

                                            let load = Math.round((used / total) * 100);
                                            let loadEmoji = this._getStatusEmoji(load, [90, 70, 50, 30]);

                                            let tempEmoji = "⬜️";
                                            if (temp !== "N/A") {
                                                let tempNum = parseFloat(temp);
                                                tempEmoji = this._getStatusEmoji(tempNum, [80, 70, 55, 40, 30, 0]);
                                            }

                                            resultList.push(`GPU${resultList.length} - [ ${name} ]\n${loadEmoji} [ VRAM : ${Math.round(used)}MB / ${Math.round(total)}MB ] [${load}%] ${tempEmoji} Temp ${temp} °C`);
                                        }
                                    }
                                }
                                checkComplete();
                            } catch (e) {
                                console.error(`Error processing AMD GPU info: ${e}`);
                                checkComplete();
                            }
                        });
                    } else {
                        checkComplete();
                    }
                } catch (e) {
                    console.error(`Error checking AMD: ${e}`);
                    checkComplete();
                }
            });

            // Intel/Fallback Check
            let intelSubprocess = new Gio.Subprocess({
                argv: ['lspci'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            intelSubprocess.init(null);
            intelSubprocess.communicate_utf8_async(null, null, (subprocess, res) => {
                try {
                    const [, stdout, stderr] = subprocess.communicate_utf8_finish(res);
                    const output = stdout.toString();
                    const intelMatch = output.match(/VGA.*Intel.*\[([^\]]+)\]/i);
                    const amdMatch = output.match(/VGA.*AMD.*\[([^\]]+)\]/i);
                    const nvidiaMatch = output.match(/VGA.*NVIDIA.*\[([^\]]+)\]/i);

                    if (intelMatch) {
                        resultList.push(`GPU${resultList.length} - [ ${intelMatch[1]} ]`);
                    } else if (amdMatch) {
                        resultList.push(`GPU${resultList.length} - [ ${amdMatch[1]} ]`);
                    } else if (nvidiaMatch) {
                        resultList.push(`GPU${resultList.length} - [ ${nvidiaMatch[1]} ]`);
                    }

                    if (resultList.length === 0) {
                        const vgaMatch = output.match(/VGA.*\[([^\]]+)\]/i);
                        if (vgaMatch) {
                            resultList.push(`GPU${resultList.length} - [ ${vgaMatch[1]} ]`);
                        }
                    }
                    checkComplete();
                } catch (e) {
                    console.error(`Error checking Intel/Fallback: ${e}`);
                    checkComplete();
                }
            });
        } catch (e) {
            console.error(`Error fetching GPU info: ${e}`);
            callback('Error fetching GPU info');
        }
    }

    async getMemoryInfo() {
        const now = Date.now();
        if (this._cache.memoryInfo.data &&
            now - this._cache.memoryInfo.timestamp < this._cacheTTL.memoryInfo) {
            return this._cache.memoryInfo.data;
        }

        try {
            const subprocess = new Gio.Subprocess({
                argv: ['free', '-k'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const lines = stdout.toString().trim().split('\n');
            const memLine = lines.find(line => line.trim().toLowerCase().startsWith("mem:"));

            if (!memLine) {
                throw new Error("Unable to parse memory data");
            }

            const parts = memLine.trim().split(/\s+/);
            const [total, used, free, shared, buff_cache, available] = parts.slice(1).map(Number);

            const totalGB = (total / 1024 / 1024).toFixed(1);
            const usedGB = (used / 1024 / 1024).toFixed(1);
            const cacheGB = (buff_cache / 1024 / 1024).toFixed(1);
            const percentNum = (used / total) * 100;
            const percent = percentNum.toFixed(1);
            const loadEmoji = this._getStatusEmoji(percentNum, [90, 70, 50, 30]);

            const result = {
                max: `${totalGB} GB`,
                use: `${usedGB}`,
                percent: `${percent}%`,
                cache: `${cacheGB} GB`,
                loadEmoji
            };

            this._cache.memoryInfo = {
                data: result,
                timestamp: now
            };

            return result;
        } catch (e) {
            console.error('Error reading memory info:', e);
            return { error: "Error reading memory info" };
        }
    }

    async getStorageInfo() {
        const now = Date.now();
        if (this._cache.storageInfo.data && 
            now - this._cache.storageInfo.timestamp < this._cacheTTL.storageInfo) {
            return this._cache.storageInfo.data;
        }

        try {
            const subprocess = new Gio.Subprocess({
                argv: ['df', '-h'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const output = stdout.toString().trim();
            const lines = output.split("\n").slice(1);
            let result = [];

            for (let line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 6) {
                    const [filesystem, size, used, available, use_percent, mount] = parts;

                    if (!filesystem.startsWith("/dev/")) continue;

                    let percent = parseInt(use_percent.replace('%', ''));
                    let loadEmoji = this._getStatusEmoji(percent, [80, 60, 50, 40]);

                    result.push(`- ${filesystem} (  ${mount}  )\n${loadEmoji} [ ${used} / ${size} ] [${use_percent}] Avail ${available}\n`);
                }
            }

            const finalResult = result.length > 0 ? result.join("\n") : "No real devices found";
            this._cache.storageInfo = {
                data: finalResult,
                timestamp: now
            };
            return finalResult;
        } catch (e) {
            console.error('Error reading storage data:', e);
            return "Error reading storage data";
        }
    }

    async getPowerInfo() {
        const now = Date.now();
        if (this._cache.powerInfo.data &&
            now - this._cache.powerInfo.timestamp < this._cacheTTL.powerInfo) {
            return this._cache.powerInfo.data;
        }

        try {
            // First get the battery device path
            const findBatterySubprocess = new Gio.Subprocess({
                argv: ['upower', '-e'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            findBatterySubprocess.init(null);
            
            const [, batteryList] = await new Promise((resolve, reject) => {
                findBatterySubprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            const batteryPath = batteryList.toString().split('\n').find(line => line.includes('BAT'));
            if (!batteryPath) {
                return "No battery found";
            }

            // Now get the battery info
            const subprocess = new Gio.Subprocess({
                argv: ['upower', '-i', batteryPath],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            subprocess.init(null);
            
            const [, stdout] = await new Promise((resolve, reject) => {
                subprocess.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        resolve(proc.communicate_utf8_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            let output = stdout.toString();
            let state = "";
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

            const info = `${percentage}% | ${wattage}W\n${state}${time ? " | " + time : ""}`;
            
            this._cache.powerInfo = {
                data: info,
                timestamp: now
            };
            
            return info;
        } catch (e) {
            console.error('Error reading power data:', e);
            return "Error reading power data";
        }
    }
} 