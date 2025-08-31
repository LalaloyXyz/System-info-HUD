// updateData.js
// Efficient, dynamic UI update logic for all sections

export function updateCPUData({ cpuName, coreBox }, cpuInfo, St) {
    if (cpuName && cpuInfo)
        cpuName.text = `${cpuInfo.cpu} x ${cpuInfo.core}`;
    if (coreBox && cpuInfo && cpuInfo.coreSpeeds) {
        const children = coreBox.get_children();
        const existingCount = children.length;
        const newCount = cpuInfo.coreSpeeds.length;
        // Update existing labels
        for (let i = 0; i < Math.min(existingCount, newCount); i++) {
            if (children[i].text !== cpuInfo.coreSpeeds[i]) {
                children[i].text = cpuInfo.coreSpeeds[i];
            }
        }
        // Add new labels if needed
        if (existingCount < newCount) {
            for (let i = existingCount; i < newCount; i++) {
                const label = new St.Label({
                    text: cpuInfo.coreSpeeds[i],
                    x_expand: true
                });
                coreBox.add_child(label);
            }
        } else if (existingCount > newCount) {
            for (let i = newCount; i < existingCount; i++) {
                children[i].hide();
            }
        }
    }
}

export function updateMemoryData({ memoryUse, memoryCache }, memoryInfo) {
    if (!memoryInfo) {
        if (memoryUse) memoryUse.text = 'Error: No data';
        if (memoryCache) memoryCache.text = '';
        return;
    }
    if (memoryInfo.error) {
        if (memoryUse) memoryUse.text = memoryInfo.error;
        if (memoryCache) memoryCache.text = '';
    } else {
        if (memoryUse) memoryUse.text = `${memoryInfo.loadEmoji} [ ${memoryInfo.use} / ${memoryInfo.max} ] [${memoryInfo.percent}]`;
        if (memoryCache) memoryCache.text = `Cache ${memoryInfo.cache}`;
    }
}

export function updateNetworkData({ wifiSpeedLabel, publicIPLabel, localIPLabel }, networkInfo) {
    if (!networkInfo) return;
    if (wifiSpeedLabel) {
        const { networkSpeed, wifiSSID } = networkInfo;
        const download = networkSpeed?.download || '0';
        const upload = networkSpeed?.upload || '0';
        const ssid = wifiSSID || 'Unknown';
        wifiSpeedLabel.text = `${ssid} ↓ ${download} ↑ ${upload}`;
    }
    if (publicIPLabel) publicIPLabel.text = networkInfo.publicIP || 'Unknown';
    if (localIPLabel) localIPLabel.text = networkInfo.lanIP || 'Unknown';
}

export function updateStorageData({ storageBox }, storageInfo, St) {
    if (!storageBox) return;
    const storageInfoLines = storageInfo ? storageInfo.split('\n') : [];
    const children = storageBox.get_children();
    // Update existing labels
    for (let i = 0; i < Math.min(children.length, storageInfoLines.length); i++) {
        if (children[i].text !== storageInfoLines[i]) {
            children[i].text = storageInfoLines[i];
        }
    }
    // Add new labels if needed
    if (children.length < storageInfoLines.length) {
        for (let i = children.length; i < storageInfoLines.length; i++) {
            const label = new St.Label({
                text: storageInfoLines[i],
                x_expand: true
            });
            storageBox.add_child(label);
        }
    } else if (children.length > storageInfoLines.length) {
        for (let i = storageInfoLines.length; i < children.length; i++) {
            children[i].hide();
        }
    }
}

export function updatePowerData({ powerShow }, powerInfo) {
    if (powerShow) powerShow.text = powerInfo || 'No battery found';
}

export function updateOSData({ device_OS, device_Kernel }, systemInfo) {
    if (!systemInfo) return;
    if (device_OS) device_OS.text = `OS : ${systemInfo.osName} [${systemInfo.osType}]`;
    if (device_Kernel) device_Kernel.text = `Kernel : Linux ${systemInfo.kernelVersion}`;
}

export function updateDeviceData({ deviceWithUptime }, uptime) {
    if (deviceWithUptime) deviceWithUptime.text = uptime;
}

export function updateGPUData({ gpuBox, gpuHead }, gpuInfo, themeColors, St) {
    if (gpuBox) {
        if (gpuHead)
            gpuHead.set_style(`color: ${themeColors.secondaryText}; font-weight: bold; font-size: 13px;`);
        if (gpuInfo) {
            const lines = gpuInfo.split('\n').filter(line => line.trim() !== '');
            const children = gpuBox.get_children();
            const existingCount = children.length;
            const newCount = lines.length;
            // Update existing labels
            for (let i = 0; i < Math.min(existingCount, newCount); i++) {
                if (children[i].text !== lines[i]) {
                    children[i].text = lines[i];
                }
                children[i].set_style(`color: ${themeColors.text}; font-weight: bold; font-size: 11px;`);
            }
            // Add new labels if needed
            if (existingCount < newCount) {
                for (let i = existingCount; i < newCount; i++) {
                    const label = new St.Label({
                        text: lines[i],
                        style: `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`,
                        x_expand: true
                    });
                    gpuBox.add_child(label);
                }
            } else if (existingCount > newCount) {
                for (let i = newCount; i < existingCount; i++) {
                    children[i].hide();
                }
            }
        }
    }
}
