import { BaseModule } from './baseModule.js';

export class StorageModule extends BaseModule {
    constructor() {
        super(60000); // 1 minute cache TTL
    }

    async getStorageInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        try {
            const output = await this._executeCommand(['df', '-h']);
            const lines = output.trim().split("\n").slice(1);
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
            this._updateCache(finalResult);
            return finalResult;
        } catch (e) {
            console.error('Error reading storage data:', e);
            return "Error reading storage data";
        }
    }

    getInfo() {
        return this.getStorageInfo();
    }
} 