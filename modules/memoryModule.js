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
            // Locale-independent parse: pick the first line with 6+ numeric columns
            // (works for labels like "Mem:", "Speicher:", etc.).
            const memLine = lines.find(line => {
                const nums = line.match(/\d+/g);
                return nums && nums.length >= 6;
            });

            if (!memLine) {
                throw new Error("Unable to parse memory data");
            }

            const [total, used, free, shared, buff_cache, available] =
                memLine.match(/\d+/g).slice(0, 6).map(Number);

            // Parse swap line in a locale-independent way:
            // find another line (not mem line) that has at least 3 numeric columns.
            const swapLine = lines.find(line => {
                if (line === memLine)
                    return false;
                const nums = line.match(/\d+/g);
                return nums && nums.length >= 3;
            });
            const [swapTotal = 0, swapUsed = 0] = swapLine
                ? swapLine.match(/\d+/g).slice(0, 2).map(Number)
                : [0, 0];

            const totalGB = (total / 1024 / 1024).toFixed(1);
            const usedGB = (used / 1024 / 1024).toFixed(1);
            const cacheGB = (buff_cache / 1024 / 1024).toFixed(1);
            const percentNum = (used / total) * 100;
            const percent = percentNum.toFixed(1);
            const loadEmoji = this._getStatusEmoji(percentNum, [90, 70, 50, 30]);
            const swapTotalGB = (swapTotal / 1024 / 1024).toFixed(1);
            const swapUsedGB = (swapUsed / 1024 / 1024).toFixed(1);
            const swapPercentNum = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0;
            const swapPercent = swapPercentNum.toFixed(1);

            const result = {
                max: `${totalGB} GB`,
                use: `${usedGB}`,
                percent: `${percent}%`,
                cache: `${cacheGB} GB`,
                loadEmoji,
                swapUse: `${swapUsedGB}`,
                swapMax: `${swapTotalGB} GB`,
                swapPercent: `${swapPercent}%`
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