import { BaseModule } from './baseModule.js';

export class PowerModule extends BaseModule {
    constructor() {
        super(5000); // 5 second cache TTL
    }

    async getPowerInfo() {
        if (this._isCacheValid()) {
            return this._cache.data;
        }

        try {
            // First get the battery device path
            const batteryList = await this._executeCommand(['upower', '-e']);
            const batteryPath = batteryList.split('\n').find(line => line.includes('BAT'));
            
            if (!batteryPath) {
                return "No battery found";
            }

            // Now get the battery info
            const output = await this._executeCommand(['upower', '-i', batteryPath]);
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
            
            this._updateCache(info);
            return info;
        } catch (e) {
            console.error('Error reading power data:', e);
            return "Error reading power data";
        }
    }

    getInfo() {
        return this.getPowerInfo();
    }
} 