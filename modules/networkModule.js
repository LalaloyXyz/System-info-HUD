import { BaseModule } from './baseModule.js';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

export class NetworkModule extends BaseModule {
    constructor() {
        super(1000); // 1 second cache TTL
        this._networkInterface = { lastIface: null, lastRx: 0, lastTx: 0, lastTimestamp: 0 };
        this._execCache = {};
        this._publicIPInFlight = false;
        this._cacheData = {
            lanIP: { data: null, timestamp: 0 },
            publicIP: { data: null, timestamp: 0 },
            wifiSSID: { data: null, timestamp: 0 },
            networkSpeed: { data: null, timestamp: 0 }
        };
        this._cacheTTLData = {
            lanIP: 60000,        // 1 m
            publicIP: 120000,    // 2 m
            wifiSSID: 10000,     // 10 s
            networkSpeed: 1000   // 1 s
        };
    }

    _getCachedPublicIP(now = Date.now()) {
        if (this._cacheData.publicIP.data &&
            now - this._cacheData.publicIP.timestamp < this._cacheTTLData.publicIP) {
            return this._cacheData.publicIP.data;
        }
        return null;
    }

    _ensurePublicIPRefresh(now = Date.now()) {
        const cached = this._getCachedPublicIP(now);
        if (cached || this._publicIPInFlight)
            return;

        this._publicIPInFlight = true;
        this._fetchAndCachePublicIP()
            .catch(e => logError(e, 'System HUD: Failed to refresh public IP'))
            .finally(() => { this._publicIPInFlight = false; });
    }

    async _fetchAndCachePublicIP() {
        const session = new Soup.Session();
        try {
            // libsoup timeout is in seconds; keep it low so UI isn't waiting on this indefinitely.
            session.timeout = 3;
        } catch (e) {
            // ignore if property is not available
        }
        const message = Soup.Message.new('GET', 'https://api.ipify.org');

        const response = await new Promise((resolve, reject) => {
            session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
                try {
                    const bytes = sess.send_and_read_finish(res);
                    resolve(bytes ? bytes.get_data() : null);
                } catch (e) {
                    reject(e);
                }
            });
        });

        if (!response)
            return;

        const decoder = new TextDecoder();
        const ip = decoder.decode(response).trim();
        if (!ip)
            return;

        this._cacheData.publicIP = {
            data: ip,
            timestamp: Date.now(),
        };
    }

    async _hasExecutable(bin) {
        if (this._execCache[bin] !== undefined)
            return this._execCache[bin];
        try {
            const out = await this._executeCommand(['which', bin]);
            const exists = !!(out && out.trim());
            this._execCache[bin] = exists;
            return exists;
        } catch (e) {
            this._execCache[bin] = false;
            return false;
        }
    }

    async getNetworkInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        try {
            // Public IP may be slow (network request). Fetch SSID/speed/local IP first,
            // then refresh public IP in the background and surface cached/placeholder immediately.
            const [lanIP, wifiSSID, networkSpeed] = await Promise.all([
                this.getLocalIP(),
                this.getWifiSSID(),
                this.getNetworkSpeed()
            ]);

            const now = Date.now();
            const publicIP = this._getCachedPublicIP(now) || (this._cacheData.publicIP.data || 'Fetching…');
            this._ensurePublicIPRefresh(now);

            const result = {
                lanIP,
                publicIP,
                wifiSSID,
                networkSpeed
            };

            this._updateCache(result);
            return result;
        } catch (e) {
            logError(e, 'System HUD: Error getting network info');
            return { error: 'Failed to get network information' };
        }
    }

    async getLocalIP() {
        const now = Date.now();
        if (this._cacheData.lanIP.data && 
            now - this._cacheData.lanIP.timestamp < this._cacheTTLData.lanIP) {
            return this._cacheData.lanIP.data;
        }

        try {
            const output = await this._executeCommand(['ip', 'route', 'get', '1.1.1.1']);
            const match = output.match(/src (\d+\.\d+\.\d+\.\d+)/);
            if (match) {
                const local_ip = match[1];
                this._cacheData.lanIP = {
                    data: local_ip,
                    timestamp: now
                };
                return local_ip;
            }
        } catch (e) {
            logError(e, 'System HUD: Failed to get LAN IP');
        }
        return 'Unknown';
    }

    async getPublicIP() {
        const now = Date.now();
        if (this._cacheData.publicIP.data && 
            now - this._cacheData.publicIP.timestamp < this._cacheTTLData.publicIP) {
            return this._cacheData.publicIP.data;
        }

        try {
            const session = new Soup.Session();
            try {
                session.timeout = 3;
            } catch (e) {
                // ignore if property is not available
            }
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
                this._cacheData.publicIP = {
                    data: ip,
                    timestamp: now
                };
                return ip;
            }
        } catch (e) {
            logError(e, 'System HUD: Failed to get public IP');
        }
        return 'Unknown';
    }

    async getWifiSSID() {
        const now = Date.now();
        if (this._cacheData.wifiSSID.data && 
            now - this._cacheData.wifiSSID.timestamp < this._cacheTTLData.wifiSSID) {
            return this._cacheData.wifiSSID.data;
        }

        let ssidTrimmed = '';

        try {
            // Preferred: iwgetid (wireless-tools)
            if (await this._hasExecutable('iwgetid')) {
                const ssid = await this._executeCommand(['iwgetid', '-r']);
                ssidTrimmed = (ssid || '').trim();
            }
        } catch (e) {
            ssidTrimmed = '';
        }

        if (!ssidTrimmed) {
            try {
                // Fedora/NetworkManager fallback
                if (await this._hasExecutable('nmcli')) {
                    const nmOut = await this._executeCommand([
                        'nmcli', '-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'
                    ]);
                    const active = nmOut.split('\n').find(line => line.startsWith('yes:'));
                    if (active)
                        ssidTrimmed = active.slice(4).trim();
                }
            } catch (e) {
                ssidTrimmed = '';
            }
        }

        if (!ssidTrimmed) {
            try {
                // Final fallback from iw output
                if (await this._hasExecutable('iw')) {
                    const iwOut = await this._executeCommand(['iw', 'dev']);
                    const match = iwOut.match(/^\s*ssid\s+(.+)$/m);
                    if (match)
                        ssidTrimmed = match[1].trim();
                }
            } catch (e) {
                ssidTrimmed = '';
            }
        }

        const finalSsid = ssidTrimmed || 'Not connected';
        this._cacheData.wifiSSID = {
            data: finalSsid,
            timestamp: now
        };
        return finalSsid;
    }

    async getNetworkSpeed() {
        const now = Date.now();
        if (this._cacheData.networkSpeed.data && 
            now - this._cacheData.networkSpeed.timestamp < this._cacheTTLData.networkSpeed) {
            return this._cacheData.networkSpeed.data;
        }
    
        try {
            const output = await this._executeCommand(['cat', '/proc/net/dev']);
            const lines = output.split('\n').slice(2);
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
    
            if (!this._networkInterface.lastTimestamp) {
                this._networkInterface = {
                    lastIface: activeIface,
                    lastRx: rx,
                    lastTx: tx,
                    lastTimestamp: now
                };
            } else if (activeIface === this._networkInterface.lastIface) {
                const dt = (now - this._networkInterface.lastTimestamp) / 1000;
                if (dt > 0) {
                    const rxDiff = rx - this._networkInterface.lastRx;
                    const txDiff = tx - this._networkInterface.lastTx;
                    
                    const rxSpeed = rxDiff / dt;
                    const txSpeed = txDiff / dt;
                    
                    down = this._formatSpeed(rxSpeed);
                    up = this._formatSpeed(txSpeed);
                }
            }
    
            this._networkInterface = {
                lastIface: activeIface,
                lastRx: rx,
                lastTx: tx,
                lastTimestamp: now
            };
            
            const result = { download: down, upload: up };
            this._cacheData.networkSpeed = {
                data: result,
                timestamp: now
            };
            
            return result;
        } catch (e) {
            logError(e, 'System HUD: NetSpeed error');
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

    getInfo() {
        return this.getNetworkInfo();
    }
} 
