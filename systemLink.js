import { CPUModule } from './modules/cpuModule.js';
import { GPUModule } from './modules/gpuModule.js';
import { MemoryModule } from './modules/memoryModule.js';
import { StorageModule } from './modules/storageModule.js';
import { NetworkModule } from './modules/networkModule.js';
import { SystemModule } from './modules/systemModule.js';
import { PowerModule } from './modules/powerModule.js';

export class SystemLink {
    constructor() {
        this.modules = {
            cpu: new CPUModule(),
            gpu: new GPUModule(),
            memory: new MemoryModule(),
            storage: new StorageModule(),
            network: new NetworkModule(),
            system: new SystemModule(),
            power: new PowerModule()
        };
    }

    async getAllInfo() {
        try {
            const [
                systemInfo,
                cpuInfo,
                gpuInfo,
                memoryInfo,
                storageInfo,
                networkInfo,
                powerInfo,
                uptime
            ] = await Promise.all([
                this.modules.system.getSystemInfo(),
                this.modules.cpu.getCPUInfo(),
                this.modules.gpu.getGPUInfo(),
                this.modules.memory.getMemoryInfo(),
                this.modules.storage.getStorageInfo(),
                this.modules.network.getNetworkInfo(),
                this.modules.power.getPowerInfo(),
                this.modules.system.getUptime()
            ]);

            return {
                system: systemInfo,
                cpu: cpuInfo,
                gpu: gpuInfo,
                memory: memoryInfo,
                storage: storageInfo,
                network: networkInfo,
                power: powerInfo,
                uptime: uptime
            };
        } catch (error) {
            logError(error, 'System HUD: Error getting all system info');
            return { error: 'Failed to get system information' };
        }
    }

    async getModuleInfo(moduleName) {
        if (!this.modules[moduleName]) {
            throw new Error(`Unknown module: ${moduleName}`);
        }
        return await this.modules[moduleName].getInfo();
    }

    async getCPUInfo() {
        return await this.modules.cpu.getCPUInfo();
    }

    async getGPUInfo() {
        return await this.modules.gpu.getGPUInfo();
    }

    async getMemoryInfo() {
        return await this.modules.memory.getMemoryInfo();
    }

    async getStorageInfo() {
        return await this.modules.storage.getStorageInfo();
    }

    async getNetworkInfo() {
        return await this.modules.network.getNetworkInfo();
    }

    async getSystemInfo() {
        return await this.modules.system.getSystemInfo();
    }

    async getPowerInfo() {
        return await this.modules.power.getPowerInfo();
    }

    async getUptime() {
        return await this.modules.system.getUptime();
    }

    clearCache() {
        Object.values(this.modules).forEach(module => {
            module.clearCache();
        });
    }

    getAvailableModules() {
        return Object.keys(this.modules);
    }

    destroy() {
        for (const module of Object.values(this.modules))
            module.destroy();
    }
} 
