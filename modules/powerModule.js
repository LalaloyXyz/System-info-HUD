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
            const batteryPaths = batteryList
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean);
            // Prefer the laptop battery over Bluetooth/HID batteries, which
            // can also appear in `upower -e` and report a different state.
            const batteryPath = batteryPaths.find(line => /\/battery_BAT\d+$/i.test(line))
                || batteryPaths.find(line => /\/battery_/i.test(line));
            
            if (!batteryPath) {
                return "No battery found";
            }

            // Now get the battery info
            const output = await this._executeCommand(['upower', '-i', batteryPath]);
            let state = "";
            let percentage = "";
            let wattage = "";
            let time = "";

            let stateMatch = output.match(/^\s*state:\s*([a-z-]+)/im);
            if (stateMatch && stateMatch[1]) {
                state = stateMatch[1].toLowerCase()
                    .split('-')
                    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                    .join(' ');
            }

            let percentMatch = output.match(/^\s*percentage:\s*(\d+(\.\d+)?)%/im);
            if (percentMatch && percentMatch[1]) {
                percentage = parseFloat(percentMatch[1]).toFixed(1);
            }

            let rateMatch = output.match(/^\s*energy-rate:\s*(\d+(\.\d+)?)\s*W/im);
            if (rateMatch && rateMatch[1]) {
                wattage = parseFloat(rateMatch[1]).toFixed(2);
            }

            let timeMatch = output.match(/^\s*time to (empty|full):\s*(.+)$/im);
            if (timeMatch) {
                time = timeMatch[2].trim();
            }

            const info = `${percentage}% | ${wattage}W\n${state}${time ? " | " + time : ""}`;
            
            this._updateCache(info);
            return info;
        } catch (e) {
            logError(e, 'System HUD: Error reading power data');
            return "Error reading power data";
        }
    }

    getInfo() {
        return this.getPowerInfo();
    }
} 
