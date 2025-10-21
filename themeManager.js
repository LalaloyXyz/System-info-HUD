import Gio from 'gi://Gio';

export class ThemeManager {
    constructor() {
        this._themeSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface'
        });
        this._themeChangedHandlers = [];
        // ID returned by Gio.Settings.connect for the color-scheme change
        this._settingsSignalId = null;
    }

    getThemeColors() {
        const colorScheme = this._themeSettings.get_string('color-scheme');
        const isDarkTheme = colorScheme === 'prefer-dark';
        return {
            background: isDarkTheme ? '#212121' : '#f5f5f5',
            text: isDarkTheme ? 'white' : 'black',
            secondaryText: isDarkTheme ? 'rgb(180, 180, 180)' : 'rgb(45, 45, 45)',
            accent: isDarkTheme ? 'black' : 'white',
            isDark: isDarkTheme
        };
    }

    connectThemeChanged(handler) {
        const handlerId = this._themeChangedHandlers.length;
        this._themeChangedHandlers.push(handler);

        // If this is the first handler, connect to Gio.Settings change signal
        if (this._settingsSignalId === null) {
            this._settingsSignalId = this._themeSettings.connect('changed::color-scheme', () => {
                this.emitThemeChanged();
            });
        }

        // Call the handler immediately so UI can apply current theme right away
        try {
            handler();
        } catch (e) {
            // swallow handler errors to avoid breaking connect
            logError(e);
        }

        return handlerId;
    }

    disconnectThemeChanged(handlerId) {
        if (handlerId >= 0 && handlerId < this._themeChangedHandlers.length) {
            this._themeChangedHandlers[handlerId] = null;
        }

        // If no handlers left, disconnect the Gio.Settings signal
        const anyRemaining = this._themeChangedHandlers.some(h => !!h);
        if (!anyRemaining && this._settingsSignalId !== null) {
            try {
                this._themeSettings.disconnect(this._settingsSignalId);
            } catch (e) {
                // ignore disconnect errors
            }
            this._settingsSignalId = null;
        }
    }

    emitThemeChanged() {
        for (const handler of this._themeChangedHandlers) {
            if (handler) {
                try {
                    handler();
                } catch (e) {
                    // keep other handlers running even if one fails
                    logError(e);
                }
            }
        }
    }
}

export function updateCPUSectionStyle({ cpuHead, cpuName, coreBox }, themeColors, St) {
    if (cpuHead)
        cpuHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
    if (cpuName)
        cpuName.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 14px;`);
    if (coreBox) {
        const children = coreBox.get_children();
        for (let i = 0; i < children.length; i++) {
            if (children[i] instanceof St.Label) {
                children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
            }
        }
    }
}

export function updateNetworkSectionStyle({ wifiSpeedLabel, wifiLabel, publicIPLabel, publicIPDescLabel, localIPLabel, localIPDescLabel }, themeColors) {
    if (wifiSpeedLabel)
        wifiSpeedLabel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 13px;`);
    if (wifiLabel)
        wifiLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
    if (publicIPLabel)
        publicIPLabel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
    if (publicIPDescLabel)
        publicIPDescLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`);
    if (localIPLabel)
        localIPLabel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
    if (localIPDescLabel)
        localIPDescLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 12px;`);
}

export function updateMemorySectionStyle({ memoryUse, memoryCache, memoryHead }, themeColors) {
    if (memoryUse)
        memoryUse.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
    if (memoryCache)
        memoryCache.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
    if (memoryHead)
        memoryHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
}

export function updateStorageSectionStyle({ storageBox, storageHead }, themeColors) {
    if (storageBox) {
        const children = storageBox.get_children();
        for (let i = 0; i < children.length; i++) {
            children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
        }
    }
    if (storageHead)
        storageHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
}

export function updatePowerSectionStyle({ powerShow, powerHead }, themeColors) {
    if (powerShow)
        powerShow.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 12px;`);
    if (powerHead)
        powerHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
}

export function updateOSSectionStyle({ device_OS, device_Kernel }, themeColors) {
    if (device_OS)
        device_OS.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 18px;`);
    if (device_Kernel)
        device_Kernel.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 16px;`);
}

export function updateDeviceSectionStyle({ deviceWithUptime, deviceLabel }, themeColors) {
    if (deviceWithUptime)
        deviceWithUptime.set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 16px;`);
    if (deviceLabel)
        deviceLabel.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 14px;`);
}

export function updateGPUSectionStyle({ gpuHead, gpuBox }, themeColors, St) {
    if (gpuHead)
        gpuHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
    if (gpuBox) {
        const children = gpuBox.get_children();
        for (let i = 0; i < children.length; i++) {
            if (children[i] instanceof St.Label) {
                children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
            }
        }
    }
}