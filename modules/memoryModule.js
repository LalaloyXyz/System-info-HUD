import { BaseModule } from './baseModule.js';

export class MemoryModule extends BaseModule {
    constructor() {
        super(3000); // 3 second cache TTL
    }

    async getMemoryInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        try {
            const output = await this._executeCommand(['free', '-k']);
            const lines = output.trim().split('\n');
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

            this._updateCache(result);
            return result;
        } catch (e) {
            console.error('Error reading memory info:', e);
            return { error: "Error reading memory info" };
        }
    }

    getInfo() {
        return this.getMemoryInfo();
    }
} 