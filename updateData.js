// updateData.js
// Efficient, dynamic UI update logic for all sections

import Clutter from 'gi://Clutter';
import Cairo from 'cairo';

const DETAIL_LABEL_STYLE = 'font-weight: bold; font-size: 11px;';
const HELP_LABEL_STYLE = 'font-weight: bold; font-size: 10px;';

const TOOL_HELP = {
    cpuInfo: 'Need: lscpu (util-linux).',
    cpuTemp: 'Need: sensors (lm-sensors).',
    memory: 'Need: free (procps/procps-ng).',
    storage: 'Need: df (coreutils).',
    localIP: 'Need: ip (iproute2).',
    wifi: 'Need: iwgetid, nmcli, or iw.',
    power: 'Need: upower.',
    gpu: 'Need: lspci, sensors, nvidia-smi/rocm-smi.'
};

function detailLabelStyle(themeColors) {
    const color = themeColors ? `color: ${themeColors.text}; ` : '';
    return `${color}${DETAIL_LABEL_STYLE}`;
}

function helpLabelStyle(themeColors) {
    const color = themeColors ? `color: ${themeColors.secondaryText || themeColors.text}; ` : '';
    return `${color}${HELP_LABEL_STYLE}`;
}

function setBoxLines(box, lines, themeColors, St) {
    if (!box) return;

    const children = box.get_children();
    for (let i = 0; i < Math.min(children.length, lines.length); i++) {
        if (children[i].text !== lines[i].text)
            children[i].text = lines[i].text;
        children[i].set_style(lines[i].style);
        children[i].show();
    }

    if (children.length < lines.length) {
        for (let i = children.length; i < lines.length; i++) {
            box.add_child(new St.Label({
                text: lines[i].text,
                style: lines[i].style,
                x_expand: true
            }));
        }
    } else if (children.length > lines.length) {
        for (let i = lines.length; i < children.length; i++)
            children[i].hide();
    }
}

function getGreenToRedColor(value, thresholds) {
    if (value >= thresholds.hot)
        return '#ff5f57';
    if (value >= thresholds.warm)
        return '#ff9f45';
    if (value >= thresholds.medium)
        return '#ffd54f';
    return '#28be4b';
}

function getBatteryColor(percent, state) {
    if (/full/i.test(state || '') || percent >= 80)
        return '#28be4b';
    if (percent >= 50)
        return '#a8d64a';
    if (percent >= 25)
        return '#ffcc33';
    if (percent >= 15)
        return '#ff9f45';
    return '#ff5f57';
}

const ACCENT_COLORS = {
    blue: '#64d2ff',
    cyan: '#5ee7df',
    green: '#58e6a6',
    yellow: '#ffcc66',
    orange: '#ff9f5a',
    red: '#ff6b6b',
    purple: '#b99cff',
    pink: '#ff8bd1'
};

const CORE_GRAPH_COLORS = [
    [0.58, 0.30, 0.95],
    [0.35, 0.25, 0.95],
    [0.25, 0.48, 1.0],
    [0.22, 0.72, 1.0],
    [0.20, 0.90, 0.88],
    [0.18, 0.82, 0.55],
    [0.45, 0.88, 0.25],
    [0.78, 0.92, 0.18],
    [1.0, 0.82, 0.18],
    [1.0, 0.60, 0.12],
    [1.0, 0.38, 0.16],
    [0.95, 0.16, 0.28]
];

function getCoreGraphColor(index) {
    return CORE_GRAPH_COLORS[index % CORE_GRAPH_COLORS.length];
}

function getCoreGraphCssColor(index) {
    const [red, green, blue] = getCoreGraphColor(index);
    return `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
}

function clearBox(box) {
    for (const child of box.get_children())
        child.destroy();
}

function addCpuCell(row, text, style, width, St) {
    row.add_child(new St.Label({
        text,
        style: `${style}${width ? ` min-width: ${width}px;` : ''}`
    }));
}

function addCpuIndicator(row, color, St) {
    row.add_child(new St.Widget({
        style: `width: 8px; height: 8px; border-radius: 4px; background-color: ${color}; margin: 3px 6px 0 0;`
    }));
}

function sectionTextColors(themeColors) {
    const textColor = themeColors?.text || '#ffffff';
    const secondaryColor = themeColors?.secondaryText || textColor;
    return {
        textColor,
        secondaryColor,
        baseStyle: `color: ${textColor}; font-weight: bold; font-size: 10px;`,
        subtleStyle: `color: ${secondaryColor}; font-weight: bold; font-size: 10px;`
    };
}

function addMetricCell(row, text, style, width, St) {
    row.add_child(new St.Label({
        text,
        style: `${style}${width ? ` min-width: ${width}px;` : ''}`
    }));
}

function addMetricIndicator(row, color, St) {
    row.add_child(new St.Widget({
        style: `width: 3px; height: 18px; border-radius: 2px; background-color: ${color}; margin: 1px 7px 0 0;`
    }));
}

function addMetricBar(row, value, color, St, width = 48) {
    const safeValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    const bar = new St.BoxLayout({
        style: `width: ${width}px; height: 4px; border-radius: 2px; background-color: rgba(255, 255, 255, 0.12); margin: 7px 8px 0 0;`
    });
    bar.add_child(new St.Widget({
        style: `width: ${Math.max(3, Math.round(safeValue * width / 100))}px; height: 4px; border-radius: 2px; background-color: ${color};`
    }));
    row.add_child(bar);
}

function addMetricRow(box, { name, value, percent, detail, color, nameWidth = 54, valueWidth = 70, detailWidth = 80 }, themeColors, St) {
    const { baseStyle, subtleStyle } = sectionTextColors(themeColors);
    const nameStyle = `color: ${color}; font-weight: bold; font-size: 10px;`;
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: 'padding: 3px 4px; margin-bottom: 3px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.035);'
    });

    addMetricIndicator(row, color, St);
    addMetricCell(row, name, nameStyle, nameWidth, St);
    if (value)
        addMetricCell(row, value, subtleStyle, valueWidth, St);
    if (Number.isFinite(percent))
        addMetricBar(row, percent, color, St);
    if (Number.isFinite(percent))
        addMetricCell(row, `${Math.round(percent)}%`, baseStyle, 30, St);
    if (detail)
        addMetricCell(row, detail, baseStyle, detailWidth, St);
    box.add_child(row);
}

function addTitleRow(box, title, themeColors, St) {
    const { textColor } = sectionTextColors(themeColors);
    const titleStyle = `color: ${textColor}; font-weight: bold; font-size: 11px;`;
    box.add_child(new St.Label({
        text: title,
        style: `${subtleStyle} padding: 3px 0 2px 4px;`
    }));
}

function parsePercent(value) {
    if (typeof value === 'number')
        return value;
    if (!value)
        return 0;
    const match = String(value).match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
}

function parseStorageEntries(storageInfo) {
    if (typeof storageInfo !== 'string')
        return [];

    const blocks = storageInfo.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
    const entries = [];

    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        if (lines.length < 2)
            continue;

        const headerMatch = lines[0].match(/^-?\s*(\/dev\/\S+)\s+\(\s*(.+?)\s*\)$/);
        const detailMatch = lines[1].match(/\[\s*([^\]]+)\s*\/\s*([^\]]+)\s*\]\s*\[(\d+)%\]\s*Avail\s*(\S+)/i);
        if (!headerMatch || !detailMatch)
            continue;

        entries.push({
            filesystem: headerMatch[1],
            mount: headerMatch[2],
            used: detailMatch[1],
            size: detailMatch[2],
            percent: Number.parseInt(detailMatch[3], 10),
            available: detailMatch[4]
        });
    }

    return entries;
}

function parsePowerInfo(powerInfo) {
    if (typeof powerInfo !== 'string')
        return null;

    const lines = powerInfo.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0)
        return null;

    const percentMatch = lines[0].match(/([\d.]+)%/);
    const wattMatch = lines[0].match(/([\d.]+)\s*W/i);
    const state = lines[1]?.split('|')[0]?.trim() || 'Battery';
    const time = lines[1]?.includes('|') ? lines[1].split('|').slice(1).join('|').trim() : '';

    return {
        percent: percentMatch ? parseFloat(percentMatch[1]) : null,
        wattage: wattMatch ? `${wattMatch[1]}W` : '',
        state,
        time
    };
}

function addCPUGraph(coreBox, coreDetails, loadHistory, themeColors, St) {
    const graph = new St.DrawingArea({
        width: 280,
        height: 110,
        x_expand: true,
        style: 'margin: 4px 0 8px; border-radius: 6px; background-color: rgba(255, 255, 255, 0.035);'
    });

    graph.connect('repaint', area => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const left = 24;
        const right = 8;
        const top = 10;
        const bottom = 18;
        const plotWidth = Math.max(1, width - left - right);
        const plotHeight = Math.max(1, height - top - bottom);
        const currentValues = coreDetails.map(core => Math.max(0, Math.min(100, Number(core.load) || 0)));
        const history = Array.isArray(loadHistory) && loadHistory.length > 0
            ? loadHistory
            : [currentValues];
        const coreCount = Math.max(currentValues.length, ...history.map(sample => sample.length));

        cr.setSourceRGBA(0.2, 0.2, 0.2, 0.18);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        cr.setLineWidth(1);
        for (const level of [0, 50, 100]) {
            const y = top + plotHeight - (level / 100) * plotHeight;
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.22);
            cr.moveTo(left, y);
            cr.lineTo(width - right, y);
            cr.stroke();
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.75);
            cr.setFontSize(9);
            cr.moveTo(2, y + 3);
            cr.showText(`${level}`);
        }

        if (coreCount === 0)
            return;

        const point = (sampleIndex, coreIndex) => {
            const x = history.length === 1
                ? left + plotWidth
                : left + (sampleIndex / (history.length - 1)) * plotWidth;
            const value = Math.max(0, Math.min(100, Number(history[sampleIndex]?.[coreIndex]) || 0));
            const y = top + plotHeight - (value / 100) * plotHeight;
            return [x, y];
        };

        cr.setLineWidth(2);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let coreIndex = 0; coreIndex < coreCount; coreIndex++) {
            const [red, green, blue] = getCoreGraphColor(coreIndex);
            cr.moveTo(...point(0, coreIndex));
            for (let sampleIndex = 1; sampleIndex < history.length; sampleIndex++)
                cr.lineTo(...point(sampleIndex, coreIndex));
            cr.setSourceRGB(red, green, blue);
            cr.stroke();

            const [x, y] = point(history.length - 1, coreIndex);
            cr.arc(x, y, 2.5, 0, Math.PI * 2);
            cr.fill();
        }
    });

    coreBox.add_child(graph);
}

function setCPURows(coreBox, cpuInfo, themeColors, St, showGraph = true) {
    clearBox(coreBox);

    const textColor = themeColors?.text || '#ffffff';
    const secondaryColor = themeColors?.secondaryText || textColor;
    const baseStyle = `color: ${textColor}; font-weight: bold; font-size: 11px;`;
    const subtleStyle = `color: ${secondaryColor}; font-weight: bold; font-size: 11px;`;

    if (showGraph)
        addCPUGraph(coreBox, cpuInfo.coreDetails, cpuInfo.loadHistory, themeColors, St);

    for (let coreIndex = 0; coreIndex < cpuInfo.coreDetails.length; coreIndex++) {
        const core = cpuInfo.coreDetails[coreIndex];
        const load = Number.isFinite(core.load) ? core.load : 0;
        const tempNumber = parseFloat(core.temp);
        const loadColor = getCoreGraphCssColor(coreIndex);
        const tempColor = Number.isFinite(tempNumber)
            ? getGreenToRedColor(tempNumber, { medium: 50, warm: 70, hot: 80 })
            : secondaryColor;

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            style: `padding: 4px 5px; margin-bottom: 2px; border-radius: 5px; border-left: 3px solid ${loadColor}; background-color: rgba(255, 255, 255, 0.035);`
        });

        addCpuIndicator(row, loadColor, St);
        addCpuCell(row, core.name, `${baseStyle} color: ${loadColor};`, 50, St);
        addCpuCell(row, `${core.speed} MHz`, subtleStyle, 72, St);
        addCpuCell(row, `${load}%`, baseStyle, 34, St);
        addCpuIndicator(row, tempColor, St);
        addCpuCell(row, `Temp ${core.temp} °C`, baseStyle, 70, St);
        coreBox.add_child(row);
    }

    if (cpuInfo.cpu === 'Unknown CPU' || cpuInfo.core === 0) {
        coreBox.add_child(new St.Label({ text: TOOL_HELP.cpuInfo, style: helpLabelStyle(themeColors) }));
    } else if (cpuInfo.coreDetails.some(core => core.temp === 'N/A')) {
        coreBox.add_child(new St.Label({ text: TOOL_HELP.cpuTemp, style: helpLabelStyle(themeColors) }));
    }
}

function addGpuMetricRow(gpuBox, {
    name,
    value,
    percent,
    color,
    detail = '',
    valueWidth = 108,
    percentWidth = 34,
    nameWidth = 46
}, themeColors, St) {
    const { textColor, secondaryColor } = sectionTextColors(themeColors);
    const baseStyle = `color: ${textColor}; font-weight: bold; font-size: 11px;`;
    const subtleStyle = `color: ${secondaryColor}; font-weight: bold; font-size: 10px;`;
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: 'padding: 2px 0;'
    });

    addCpuIndicator(row, color, St);
    addCpuCell(row, name, baseStyle, nameWidth, St);
    if (value)
        addCpuCell(row, value, subtleStyle, valueWidth, St);
    if (Number.isFinite(percent)) {
        addMetricBar(row, percent, color, St);
        addCpuCell(row, `${Math.round(percent)}%`, baseStyle, percentWidth, St);
    }
    if (detail)
        addCpuCell(row, detail, baseStyle, 58, St);
    gpuBox.add_child(row);
}

function addGpuDetailRow(gpuBox, details, themeColors, St) {
    if (details.length === 0)
        return;

    const { textColor, secondaryColor } = sectionTextColors(themeColors);
    const baseStyle = `color: ${textColor}; font-weight: bold; font-size: 11px;`;
    const subtleStyle = `color: ${secondaryColor}; font-weight: bold; font-size: 10px;`;
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: 'padding: 2px 0;'
    });

    for (const detail of details) {
        addCpuIndicator(row, detail.color, St);
        addCpuCell(row, detail.name, baseStyle, detail.nameWidth || 38, St);
        addCpuCell(row, detail.value, subtleStyle, detail.valueWidth || 70, St);
    }

    gpuBox.add_child(row);
}

function setGPURows(gpuBox, gpuInfo, themeColors, St) {
    clearBox(gpuBox);

    const { textColor } = sectionTextColors(themeColors);
    const titleStyle = `color: ${textColor}; font-weight: bold; font-size: 11px;`;
    const entries = gpuInfo.split(/\n\s*\n/).map(entry => entry.trim()).filter(Boolean);

    for (const entry of entries) {
        const lines = entry.split('\n').map(line => line.trim()).filter(Boolean);
        const header = lines[0]?.match(/^GPU(\d+)\s+-\s+\[\s*(.+?)\s*\]/);
        if (!header)
            continue;

        gpuBox.add_child(new St.Label({
            text: `GPU${header[1]}  ${header[2]}`,
            style: `${titleStyle} padding-top: 2px;`
        }));

        const body = lines.slice(1).join(' ');
        const vram = body.match(/VRAM:\s*([\d.]+MB)\s*\/\s*([\d.]+MB)\s*\|\s*([\d.]+)%/);
        const temp = body.match(/Temp:\s*([\d.]+)\s*°C/);
        const clock = body.match(/Clockspeed:\s*([\d.]+)(?:\s*\/\s*([\d.]+))?\s*MHz/);

        if (vram) {
            const percent = parseFloat(vram[3]);
            addGpuMetricRow(gpuBox, {
                name: 'VRAM',
                value: `${vram[1]} / ${vram[2]}`,
                percent,
                color: getGreenToRedColor(percent, { medium: 50, warm: 70, hot: 90 })
            }, themeColors, St);
        }
        const detailRows = [];
        if (temp) {
            const tempValue = parseFloat(temp[1]);
            detailRows.push({
                name: 'Temp',
                value: `${temp[1]} °C`,
                color: getGreenToRedColor(tempValue, { medium: 55, warm: 70, hot: 80 }),
                valueWidth: 58
            });
        }
        if (clock) {
            const current = parseFloat(clock[1]);
            const max = clock[2] ? parseFloat(clock[2]) : null;
            const percent = max ? (current / max) * 100 : Math.min(100, current / 20);
            detailRows.push({
                name: 'Clock',
                value: max ? `${clock[1]} / ${clock[2]} MHz` : `${clock[1]} MHz`,
                color: getGreenToRedColor(percent, { medium: 50, warm: 70, hot: 90 }),
                nameWidth: 44,
                valueWidth: 108
            });
        }
        addGpuDetailRow(gpuBox, detailRows, themeColors, St);
    }
}

export function updateCPUData({ cpuName, coreBox, showGraph = true }, cpuInfo, themeColors, St) {
    if (!St && themeColors?.Label) {
        St = themeColors;
        themeColors = null;
    }

    const labelStyle = detailLabelStyle(themeColors);
    const helpStyle = helpLabelStyle(themeColors);

    if (cpuName && cpuInfo)
        cpuName.text = `${cpuInfo.cpu} x ${cpuInfo.core}`;
    if (coreBox && cpuInfo && Array.isArray(cpuInfo.coreDetails)) {
        setCPURows(coreBox, cpuInfo, themeColors, St, showGraph);
    } else if (coreBox && cpuInfo && cpuInfo.coreSpeeds) {
        const lines = cpuInfo.coreSpeeds.map(text => ({ text, style: labelStyle }));
        if (cpuInfo.cpu === 'Unknown CPU' || cpuInfo.core === 0)
            lines.push({ text: TOOL_HELP.cpuInfo, style: helpStyle });
        else if (cpuInfo.coreSpeeds.some(line => line.includes('N/A')))
            lines.push({ text: TOOL_HELP.cpuTemp, style: helpStyle });

        setBoxLines(coreBox, lines, themeColors, St);
    }
}

export function updateMemoryData({ memoryBox, memoryUse, memorySwap, memoryCache }, memoryInfo, themeColors, St) {
    if (St && memoryBox) {
        clearBox(memoryBox);
        if (!memoryInfo) {
            memoryBox.add_child(new St.Label({ text: 'Error: No data', style: helpLabelStyle(themeColors) }));
            return;
        }
        if (memoryInfo.error) {
            memoryBox.add_child(new St.Label({ text: memoryInfo.error, style: helpLabelStyle(themeColors) }));
            memoryBox.add_child(new St.Label({ text: TOOL_HELP.memory, style: helpLabelStyle(themeColors) }));
            return;
        }

        const ramPercent = parsePercent(memoryInfo.percent);
        addGpuMetricRow(memoryBox, {
            name: 'RAM',
            value: `${memoryInfo.use} / ${memoryInfo.max}`,
            percent: ramPercent,
            color: getGreenToRedColor(ramPercent, { medium: 50, warm: 70, hot: 90 }),
            valueWidth: 88,
            percentWidth: 28,
            nameWidth: 40
        }, themeColors, St);

        const swapPercent = parsePercent(memoryInfo.swapPercent);
        addGpuDetailRow(memoryBox, [
            {
                name: 'Swap',
                value: `${memoryInfo.swapUse} / ${memoryInfo.swapMax}`,
                color: getGreenToRedColor(swapPercent, { medium: 40, warm: 60, hot: 80 }),
                nameWidth: 42,
                valueWidth: 98
            },
            {
                name: 'Cache',
                value: memoryInfo.cache,
                color: '#ffffff',
                nameWidth: 44,
                valueWidth: 64
            }
        ], themeColors, St);
        return;
    }

    if (!memoryInfo) {
        if (memoryUse) memoryUse.text = 'Error: No data';
        if (memoryCache) memoryCache.text = '';
        if (memorySwap) memorySwap.text = '';
        return;
    }
    if (memoryInfo.error) {
        if (memoryUse) memoryUse.text = memoryInfo.error;
        if (memoryCache) memoryCache.text = TOOL_HELP.memory;
        if (memoryCache && themeColors) memoryCache.set_style(helpLabelStyle(themeColors));
        if (memorySwap) memorySwap.text = '';
    } else {
        if (memoryUse) memoryUse.text = `${memoryInfo.loadEmoji} [ ${memoryInfo.use} / ${memoryInfo.max} ] [${memoryInfo.percent}]`;
        if (memorySwap) memorySwap.text = `Swap ${memoryInfo.swapUse} / ${memoryInfo.swapMax} [${memoryInfo.swapPercent}]`;
        if (memoryCache) memoryCache.text = `Cache ${memoryInfo.cache}`;
        if (memoryCache && themeColors) memoryCache.set_style(detailLabelStyle(themeColors));
    }
}

export function updateNetworkData({ wifiSpeedLabel, publicIPLabel, localIPLabel }, networkInfo) {
    if (!networkInfo) return;
    if (networkInfo.error) {
        if (wifiSpeedLabel) wifiSpeedLabel.text = 'No internet';
        if (publicIPLabel) publicIPLabel.text = 'No internet';
        if (localIPLabel) localIPLabel.text = 'No internet';
        return;
    }
    if (wifiSpeedLabel) {
        const { networkSpeed, wifiSSID } = networkInfo;
        const download = networkSpeed?.download || '0';
        const upload = networkSpeed?.upload || '0';
        const ssid = networkInfo.wifiToolMissing ? TOOL_HELP.wifi : (wifiSSID || 'Unknown');
        wifiSpeedLabel.text = `${ssid} ↓ ${download} ↑ ${upload}`;
    }
    if (publicIPLabel) publicIPLabel.text = networkInfo.publicIP || 'No internet';
    if (localIPLabel) localIPLabel.text = networkInfo.lanIP === 'Unknown' ? TOOL_HELP.localIP : (networkInfo.lanIP || 'Unknown');
}

export function updateStorageData({ storageBox }, storageInfo, themeColors, St) {
    if (!storageBox) return;
    if (St && typeof storageInfo === 'string' && storageInfo !== 'Error reading storage data') {
        clearBox(storageBox);
        const entries = parseStorageEntries(storageInfo);
        if (entries.length > 0) {
            for (const entry of entries) {
                const accentColor = getGreenToRedColor(entry.percent, { medium: 55, warm: 72, hot: 90 });
                addGpuMetricRow(storageBox, {
                    name: entry.mount,
                    value: ` ${entry.used} / ${entry.size}`,
                    percent: entry.percent,
                    detail: `Free ${entry.available}`,
                    color: accentColor,
                    nameWidth: 44,
                    valueWidth: 66,
                    percentWidth: 28
                }, themeColors, St);
            }
            return;
        }
    }

    const labelStyle = detailLabelStyle(themeColors);
    const helpStyle = helpLabelStyle(themeColors);
    const storageInfoLines = storageInfo ? storageInfo.split('\n') : [];
    const lines = storageInfoLines.map(text => ({ text, style: labelStyle }));
    if (storageInfo === 'Error reading storage data')
        lines.push({ text: TOOL_HELP.storage, style: helpStyle });

    setBoxLines(storageBox, lines, themeColors, St);
}

export function updatePowerData({ powerBox, powerShow }, powerInfo, themeColors, St) {
    if (St && powerBox) {
        clearBox(powerBox);
        if (!powerInfo) {
            powerBox.add_child(new St.Label({ text: 'No battery found', style: detailLabelStyle(themeColors) }));
            return;
        }
        if (powerInfo === 'Error reading power data') {
            powerBox.add_child(new St.Label({ text: powerInfo, style: helpLabelStyle(themeColors) }));
            powerBox.add_child(new St.Label({ text: TOOL_HELP.power, style: helpLabelStyle(themeColors) }));
            return;
        }

        const parsed = parsePowerInfo(powerInfo);
        if (parsed && Number.isFinite(parsed.percent)) {
            const powerColor = getBatteryColor(parsed.percent, parsed.state);
            addGpuMetricRow(powerBox, {
                name: parsed.state || 'Battery',
                // keep a spacer before the bar so status and bar are less cramped
                value: ' ',
                percent: parsed.percent,
                color: powerColor,
                nameWidth: 50,
                valueWidth: 18,
                percentWidth: 30
            }, themeColors, St);
            addGpuDetailRow(powerBox, [
                {
                    name: 'Use',
                    value: parsed.wattage || 'N/A',
                    color: '#ffffff',
                    nameWidth: 28,
                    valueWidth: 58
                },
                {
                    name: 'Time',
                    value: parsed.time || 'N/A',
                    color: '#ffffff',
                    nameWidth: 32,
                    valueWidth: 86
                }
            ], themeColors, St);
            return;
        }

        powerBox.add_child(new St.Label({ text: powerInfo, style: detailLabelStyle(themeColors) }));
        return;
    }

    if (!powerShow) return;
    powerShow.text = powerInfo === 'Error reading power data'
        ? `${powerInfo}\n${TOOL_HELP.power}`
        : (powerInfo || 'No battery found');
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
        const detailStyle = `color: ${themeColors.text}; font-weight: bold; font-size: 11px;`;
        if (St && gpuInfo) {
            setGPURows(gpuBox, gpuInfo, themeColors, St);
            if (gpuBox.get_children().length > 0)
                return;
        }

        const lines = gpuInfo
            ? gpuInfo.split('\n').filter(line => line.trim() !== '').map(text => ({ text, style: detailStyle }))
            : [
                { text: 'No GPU data available.', style: detailStyle },
                { text: TOOL_HELP.gpu, style: helpLabelStyle(themeColors) }
            ];

        setBoxLines(gpuBox, lines, themeColors, St);
    }
}
