import { BaseModule } from './baseModule.js';
import GLib from 'gi://GLib';

export class SystemModule extends BaseModule {
    constructor() {
        super(600000); // 10 minute cache TTL for system info
        this._uptimeCache = { data: null, timestamp: 0 };
        this._uptimeTTL = 500; // 0.5 second cache TTL for uptime
    }

    async getSystemInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        let osName = 'Unknown OS';
        try {
            const output = await this._executeCommand(['cat', '/etc/os-release']);
            const lines = output.split('\n');
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
            kernelVersion = await this._executeCommand(['uname', '-r']);
            kernelVersion = kernelVersion.trim();
        } catch (e) {
            console.error('Failed to get kernel version:', e);
        }

        // GNOME Shell version
        let gnomeVersion = 'Unknown GNOME';
        try {
            const gnomeOut = await this._executeCommand(['gnome-shell', '--version']);
            // Expected: "GNOME Shell 45.4"
            const match = gnomeOut.match(/GNOME Shell\s+([\w\.-]+)/i);
            if (match && match[1]) {
                gnomeVersion = match[1];
            } else {
                // Fallback: try reading env or leave as unknown
                const envVersion = GLib.getenv('GNOME_SHELL_VERSION');
                if (envVersion) gnomeVersion = envVersion;
            }
        } catch (e) {
            console.error('Failed to get GNOME version:', e);
        }

        // Session type (Wayland/X11)
        let sessionType = GLib.getenv('XDG_SESSION_TYPE') || 'Unknown';
        if (sessionType) sessionType = sessionType.charAt(0).toUpperCase() + sessionType.slice(1);

        const result = { osName, osType, kernelVersion, gnomeVersion, sessionType };
        this._updateCache(result);
        return result;
    }

    async getUptime() {
        const now = Date.now();
        if (this._uptimeCache.data && 
            now - this._uptimeCache.timestamp < this._uptimeTTL) {
            return this._uptimeCache.data;
        }

        try {
            const output = await this._executeCommand(['cat', '/proc/uptime']);
            const uptimeSeconds = parseFloat(output.split(' ')[0]);
            const days = Math.floor(uptimeSeconds / 86400);
            const hours = Math.floor((uptimeSeconds % 86400) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = Math.floor(uptimeSeconds % 60);

            const deviceName = GLib.get_host_name();
            const result = `${deviceName} : ${days}d ${hours}h ${minutes}m ${seconds}s`;
            
            this._uptimeCache = {
                data: result,
                timestamp: now
            };
            
            return result;
        } catch (e) {
            console.error('Failed to get uptime:', e);
        }
        return 'Unknown uptime';
    }

    getInfo() {
        return this.getSystemInfo();
    }
} 