import GLib from 'gi://GLib';
import { ServiceClient } from './serviceClient.js';

export class SystemClient extends ServiceClient {
    async getModuleInfo(moduleName) {
        try {
            return await this.call('GetInfo', new GLib.Variant('(s)', [moduleName]));
        } catch (error) {
            if (this._cancellable.is_cancelled())
                throw error;
            throw new Error('System HUD companion service unavailable. Install it as described in the extension README.');
        }
    }

    async getAllInfo() {
        const names = [...this.getAvailableModules(), 'uptime'];
        const values = await Promise.all(names.map(name => this.getModuleInfo(name)));
        return Object.fromEntries(names.map((name, index) => [name, values[index]]));
    }

    getCPUInfo() { return this.getModuleInfo('cpu'); }
    getGPUInfo() { return this.getModuleInfo('gpu'); }
    getMemoryInfo() { return this.getModuleInfo('memory'); }
    getStorageInfo() { return this.getModuleInfo('storage'); }
    getNetworkInfo() { return this.getModuleInfo('network'); }
    getSystemInfo() { return this.getModuleInfo('system'); }
    getPowerInfo() { return this.getModuleInfo('power'); }
    getUptime() { return this.getModuleInfo('uptime'); }

    clearCache() {
        this.call('ClearCache').catch(error => {
            if (!this._cancellable.is_cancelled())
                logError(error, 'System HUD: Failed to clear companion cache');
        });
    }

    getAvailableModules() {
        return ['cpu', 'gpu', 'memory', 'storage', 'network', 'system', 'power'];
    }
}
