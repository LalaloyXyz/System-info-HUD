import { verticalBox, horizontalBox } from './modules/shellCompat.js';

import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import GLib from 'gi://GLib';
import { getCpuCoreColor } from './modules/coreColors.js';

const DETAIL_LABEL_STYLE = 'font-weight: 500; font-size: 11px;';
const HELP_LABEL_STYLE = 'font-weight: 500; font-size: 11px;';
const cpuGraphActors = new WeakMap();
const gpuGraphActors = new WeakMap();
const cpuGraphColors = new WeakMap();
const graphMotion = new WeakMap();
const graphOptions = new WeakMap();

function graphHistory(graph, fallback) {
    return graphMotion.get(graph)?.target ?? fallback;
}

function graphScroll(graph) {
    const motion = graphMotion.get(graph);
    if (!motion?.enabled)
        return 0;
    const progress = Math.min(1, (GLib.get_monotonic_time() / 1000 - motion.started) / motion.duration);
    return motion.offset * (1 - progress);
}

function graphSampleX(graph, index, count) {
    const guard = graphMotion.has(graph) ? 1 : 0;
    return (index - guard + graphScroll(graph)) / Math.max(1, count - 1 - guard);
}

function updateGraphMotion(graph, history, box) {
    if (!history?.length)
        return;
    const options = graphOptions.get(box) ?? { interval: 2500, enabled: true };
    const target = [...Array.from({ length: Math.max(0, 60 - history.length) }, () => history[0]), ...history]
        .map(sample => Array.isArray(sample) ? sample.slice() : sample);
    let motion = graphMotion.get(graph);
    const changed = motion && (history.length !== motion.history.length ||
        history.some((sample, index) => sample !== motion.history[index]));
    const offset = changed ? graphScroll(graph) + 1 : 0;
    // Retain the departing sample so scrolling does not leave a gap at the left edge.
    target.unshift(changed ? motion.target[1] : target[0]);
    if (!motion) {
        motion = { target, history: history.slice(), offset: 0, started: 0, duration: 1, timer: 0 };
        graphMotion.set(graph, motion);
        const stop = () => {
            if (motion.timer) {
                GLib.source_remove(motion.timer);
                motion.timer = 0;
            }
        };
        motion.start = () => {
            if (motion.timer || !graph.mapped || !motion.enabled || graphScroll(graph) <= 0)
                return;
            motion.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 33, () => {
                graph.queue_repaint();
                if (GLib.get_monotonic_time() / 1000 - motion.started >= motion.duration) {
                    motion.timer = 0;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        };
        graph.connect('notify::mapped', () => graph.mapped ? motion.start() : stop());
        graph.connect('destroy', stop);
    }
    if (!changed && motion.enabled === options.enabled) {
        graph.queue_repaint();
        return;
    }
    motion.target = target;
    motion.history = history.slice();
    motion.offset = offset;
    motion.started = GLib.get_monotonic_time() / 1000;
    motion.enabled = options.enabled;
    // Cover the update loop's next tick and collection jitter without extrapolating values.
    motion.duration = options.enabled ? Math.max(33, options.interval + 500) : 1;
    motion.start();
    graph.queue_repaint();
}

const TOOL_HELP = {
    cpuInfo: 'Need: lscpu (util-linux).',
    cpuTemp: 'CPU temperature unavailable: requires lm-sensors and a supported CPU sensor driver.',
    memory: 'Need: free (procps/procps-ng).',
    storage: 'Need: df (coreutils).',
    localIP: 'Need: ip (iproute2).',
    wifi: 'Need: iwgetid, nmcli, or iw.',
    power: 'Need: upower.',
    gpu: 'GPU data needs a supported DRM driver; NVIDIA metrics need nvidia-smi.'
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

function getBatteryColor(percent, state, themeColors) {
    const isDark = themeColors?.isDark !== false;
    if (/full/i.test(state || '') || percent >= 50)
        return isDark ? '#30d158' : '#198038';
    if (percent >= 25)
        return isDark ? '#ffd60a' : '#9a6700';
    if (percent >= 15)
        return isDark ? '#ff9f0a' : '#b45309';
    return isDark ? '#ff453a' : '#cf222e';
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

function getCoreGraphColor(index, customColors = []) {
    const color = /^#[\da-f]{6}$/i.test(customColors[index] || '')
        ? customColors[index] : getCpuCoreColor(index);
    return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
}

function getCoreGraphCssColor(index, customColors) {
    const [red, green, blue] = getCoreGraphColor(index, customColors);
    return `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
}

function interpolateGraphColor(value, stops) {
    const safeValue = Number.isFinite(value) ? value : stops[0][0];
    if (safeValue <= stops[0][0])
        return stops[0][1];

    for (let index = 1; index < stops.length; index++) {
        const [endValue, endColor] = stops[index];
        const [startValue, startColor] = stops[index - 1];
        if (safeValue <= endValue) {
            const ratio = (safeValue - startValue) / (endValue - startValue);
            return startColor.map((channel, channelIndex) =>
                channel + (endColor[channelIndex] - channel) * ratio
            );
        }
    }

    return stops[stops.length - 1][1];
}

function getTemperatureGraphColor(value) {
    return interpolateGraphColor(value, [
        [0, [0.20, 0.78, 0.36]],
        [50, [0.95, 0.78, 0.12]],
        [70, [0.95, 0.48, 0.10]],
        [80, [0.95, 0.20, 0.20]]
    ]);
}

function getGraphCssColor(color) {
    const [red, green, blue] = color.map(channel => Math.round(channel * 255));
    return `rgb(${red}, ${green}, ${blue})`;
}

function drawSmoothTrace(cr, points, idleBaseline) {
    if (points.length === 0)
        return;

    cr.moveTo(...points[0]);
    for (let index = 1; index < points.length; index++) {
        const [previousX, previousY] = points[index - 1];
        const [currentX, currentY] = points[index];
        if (previousY === idleBaseline && currentY === idleBaseline) {
            cr.moveTo(currentX, currentY);
            continue;
        }
        const distance = (currentX - previousX) * 0.35;
        cr.curveTo(
            previousX + distance, previousY,
            currentX - distance, currentY,
            currentX, currentY
        );
    }
}

function getGpuGraphColor(value, type) {
    if (type === 'temperature') {
        return interpolateGraphColor(value, [
            [0, [0.20, 0.82, 0.48]],
            [45, [1.0, 0.82, 0.18]],
            [65, [1.0, 0.48, 0.10]],
            [80, [0.95, 0.18, 0.20]]
        ]);
    }

    return interpolateGraphColor(value, [
        [0, [0.25, 0.55, 1.0]],
        [35, [0.25, 0.82, 0.95]],
        [60, [1.0, 0.68, 0.16]],
        [80, [0.95, 0.18, 0.28]]
    ]);
}

function addGraphSummary(box, label, value, detail, themeColors, St) {
    const { textColor, secondaryColor } = sectionTextColors(themeColors);
    const row = new St.BoxLayout({ style: 'spacing: 7px; padding: 1px 0 0 4px;' });
    row.add_child(new St.Label({ text: label,
        style: `color: ${secondaryColor}; font-weight: 500; font-size: 11px;` }));
    if (value)
        row.add_child(new St.Label({ text: value,
            style: `color: ${textColor}; font-weight: 600; font-size: 12px;` }));
    if (detail)
        row.add_child(new St.Label({ text: `· ${detail}`,
            style: `color: ${secondaryColor}; font-weight: 500; font-size: 11px;` }));
    box.add_child(row);
}

function addGpuGraph(gpuBox, label, history, type, themeColors, St, unit = '%', maxValue = 100, graphKey = label, summaryOverride = null) {
    if (!Array.isArray(history) || history.length === 0)
        return;

    const values = history.filter(Number.isFinite);
    if (values.length === 0)
        return;

    const current = values[values.length - 1];
    const maximum = Math.max(...values);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const summary = summaryOverride ?? {
        label: type === 'temperature' ? 'Temperature' : label,
        value: `${current.toFixed(1)}${unit}`,
        detail: type === 'temperature' || type === 'load'
            ? `Peak ${maximum.toFixed(1)}${unit}`
            : `Avg ${average.toFixed(1)}${unit} · Peak ${maximum.toFixed(1)}${unit}`,
    };
    addGraphSummary(gpuBox, summary.label, summary.value, summary.detail, themeColors, St);

    const graphs = gpuGraphActors.get(gpuBox) || new Map();
    let graph = graphs.get(graphKey);
    if (!graph) {
        graph = new St.DrawingArea({
            width: 280,
            height: 76,
            x_expand: true,
            style: 'margin: 2px 0 3px; border: 1px solid rgba(128, 128, 128, 0.12); border-radius: 10px;'
        });
        graph.connect('repaint', area => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const left = 30;
        const right = 8;
        const top = 8;
        const bottom = 14;
        const plotWidth = Math.max(1, width - left - right);
        const plotHeight = Math.max(1, height - top - bottom);
        const samples = graphHistory(area, history);
        const visibleHistory = samples.length < 60
            ? [...Array.from({ length: 60 - samples.length }, () => samples[0]), ...samples]
            : samples;
        const point = (index, value) => [
            visibleHistory.length === 1 ? left + plotWidth : left + graphSampleX(area, index, visibleHistory.length) * plotWidth,
            top + plotHeight - (Math.max(0, Math.min(maxValue, value)) / maxValue) * plotHeight
        ];

        cr.setLineWidth(1);
        for (const level of [0, maxValue / 2, maxValue]) {
            const y = top + plotHeight - (level / maxValue) * plotHeight;
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.2);
            cr.moveTo(left, y);
            cr.lineTo(width - right, y);
            cr.stroke();
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.75);
            cr.setFontSize(10);
            cr.moveTo(2, y + 3);
            cr.showText(`${level}${unit}`);
        }

        cr.save();
        cr.rectangle(left, top, plotWidth, plotHeight);
        cr.clip();
        const points = visibleHistory.map((value, index) => point(index, value));
        cr.setLineWidth(2.5);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let index = 1; index < points.length; index++) {
            const [previousX, previousY] = points[index - 1];
            const [currentX, currentY] = points[index];
            const distance = (currentX - previousX) * 0.35;
            const value = (Number(visibleHistory[index - 1]) + Number(visibleHistory[index])) / 2;
            const [red, green, blue] = getGpuGraphColor(value, type);
            cr.moveTo(previousX, previousY);
            cr.curveTo(
                previousX + distance, previousY,
                currentX - distance, currentY,
                currentX, currentY
            );
            cr.setSourceRGB(red, green, blue);
            cr.stroke();
        }
        const [x, y] = points[points.length - 1];
        const [red, green, blue] = getGpuGraphColor(Number(visibleHistory[visibleHistory.length - 1]), type);
        cr.setSourceRGB(red, green, blue);
        cr.arc(x, y, 3, 0, Math.PI * 2);
        cr.fill();
        cr.restore();
        });
        graphs.set(graphKey, graph);
        gpuGraphActors.set(gpuBox, graphs);
    }
    gpuBox.add_child(graph);
    updateGraphMotion(graph, history, gpuBox);
}

function clearBox(box) {
    for (const child of box.get_children())
        child.destroy();
}

function addCpuCell(row, text, style, width, St, expand = false) {
    row.add_child(new St.Label({
        text,
        x_expand: expand,
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
        baseStyle: `color: ${textColor}; font-weight: 500; font-size: 11px;`,
        subtleStyle: `color: ${secondaryColor}; font-weight: 500; font-size: 11px;`
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
    const nameStyle = `color: ${color}; font-weight: 600; font-size: 11px;`;
    const row = new St.BoxLayout({
        ...horizontalBox,
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
    const titleStyle = `color: ${textColor}; font-weight: 600; font-size: 11px;`;
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

function addCPUGraph(coreBox, coreDetails, loadHistory, themeColors, St, customColors) {
    const graph = new St.DrawingArea({
        width: 280,
        height: 120,
        x_expand: true,
        style: 'margin: 2px 0 8px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;'
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
        const history = graphHistory(area, Array.isArray(loadHistory) && loadHistory.length > 0
            ? loadHistory
            : [currentValues]);
        const coreCount = Math.max(currentValues.length, ...history.map(sample => sample.length));
        const visibleHistory = history.length < 60
            ? [...Array.from({ length: 60 - history.length }, () => history[0]), ...history]
            : history;
        cr.setLineWidth(1);
        for (const level of [0, 50, 100]) {
            const y = top + plotHeight - (level / 100) * plotHeight;
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.22);
            cr.moveTo(left, y);
            cr.lineTo(width - right, y);
            cr.stroke();
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.75);
            cr.setFontSize(10);
            cr.moveTo(2, y + 3);
            cr.showText(`${level}`);
        }

        if (coreCount === 0)
            return;

        const point = (sampleIndex, coreIndex) => {
            const x = (visibleHistory.length === 1
                ? left + plotWidth
                : left + graphSampleX(area, sampleIndex, visibleHistory.length) * plotWidth);
            const value = Math.max(0, Math.min(100, Number(visibleHistory[sampleIndex]?.[coreIndex]) || 0));
            const y = top + plotHeight - (value / 100) * plotHeight;
            return [x, y];
        };

        cr.save();
        cr.rectangle(left, top, plotWidth, plotHeight);
        cr.clip();
        cr.setLineWidth(2);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let coreIndex = 0; coreIndex < coreCount; coreIndex++) {
            const [red, green, blue] = getCoreGraphColor(coreIndex, cpuGraphColors.get(area));
            const points = visibleHistory.map((_, sampleIndex) => point(sampleIndex, coreIndex));
            drawSmoothTrace(cr, points, top + plotHeight);
            cr.setSourceRGB(red, green, blue);
            cr.stroke();

            const [x, y] = points[points.length - 1];
            if (y < top + plotHeight) {
                cr.arc(x, y, 2.5, 0, Math.PI * 2);
                cr.fill();
            }
        }
        cr.restore();
    });

    cpuGraphColors.set(graph, customColors);
    coreBox.add_child(graph);
    return graph;
}

function addCPUTemperatureGraph(coreBox, coreDetails, temperatureHistory, themeColors, St) {
    const graph = new St.DrawingArea({
        width: 280,
        height: 120,
        x_expand: true,
        style: 'margin: 2px 0 8px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px;'
    });

    graph.connect('repaint', area => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const left = 30;
        const right = 8;
        const top = 10;
        const bottom = 18;
        const plotWidth = Math.max(1, width - left - right);
        const plotHeight = Math.max(1, height - top - bottom);
        const currentValues = coreDetails.map(core => {
            const value = parseFloat(core.temp);
            return Number.isFinite(value) ? value : 0;
        });
        const history = graphHistory(area, Array.isArray(temperatureHistory) && temperatureHistory.length > 0
            ? temperatureHistory
            : [currentValues]);
        const coreCount = Math.max(currentValues.length, ...history.map(sample => sample.length));
        const visibleHistory = history.length < 60
            ? [...Array.from({ length: 60 - history.length }, () => history[0]), ...history]
            : history;
        const minTemp = 0;
        const maxTemp = 100;

        cr.setLineWidth(1);
        for (const level of [0, 50, 100]) {
            const y = top + plotHeight - ((level - minTemp) / (maxTemp - minTemp)) * plotHeight;
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.22);
            cr.moveTo(left, y);
            cr.lineTo(width - right, y);
            cr.stroke();
            cr.setSourceRGBA(0.7, 0.7, 0.7, 0.75);
            cr.setFontSize(10);
            cr.moveTo(2, y + 3);
            cr.showText(`${level}°C`);
        }

        if (coreCount === 0)
            return;

        const point = (sampleIndex, coreIndex) => {
            const x = visibleHistory.length === 1
                ? left + plotWidth
                : left + graphSampleX(area, sampleIndex, visibleHistory.length) * plotWidth;
            const rawValue = Number(visibleHistory[sampleIndex]?.[coreIndex]);
            const value = Number.isFinite(rawValue) ? Math.max(minTemp, Math.min(maxTemp, rawValue)) : minTemp;
            const y = top + plotHeight - ((value - minTemp) / (maxTemp - minTemp)) * plotHeight;
            return [x, y];
        };

        cr.save();
        cr.rectangle(left, top, plotWidth, plotHeight);
        cr.clip();
        cr.setLineWidth(2.5);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let coreIndex = 0; coreIndex < coreCount; coreIndex++) {
            const points = visibleHistory.map((_, sampleIndex) => point(sampleIndex, coreIndex));
            for (let sampleIndex = 1; sampleIndex < points.length; sampleIndex++) {
                const [previousX, previousY] = points[sampleIndex - 1];
                const [currentX, currentY] = points[sampleIndex];
                const distance = (currentX - previousX) * 0.35;
                const previousValue = Number(visibleHistory[sampleIndex - 1]?.[coreIndex]) || 0;
                const currentValue = Number(visibleHistory[sampleIndex]?.[coreIndex]) || 0;
                const [red, green, blue] = getTemperatureGraphColor((previousValue + currentValue) / 2);
                cr.moveTo(previousX, previousY);
                cr.curveTo(
                    previousX + distance, previousY,
                    currentX - distance, currentY,
                    currentX, currentY
                );
                cr.setSourceRGB(red, green, blue);
                cr.stroke();
            }

            const [x, y] = points[points.length - 1];
            const [red, green, blue] = getTemperatureGraphColor(Number(visibleHistory[visibleHistory.length - 1]?.[coreIndex]) || 0);
            cr.setSourceRGB(red, green, blue);
            cr.arc(x, y, 3, 0, Math.PI * 2);
            cr.fill();
        }
        cr.restore();
    });

    coreBox.add_child(graph);
    return graph;
}

function setCPURows(coreBox, cpuInfo, themeColors, St, showGraph = true, cpuCoreColors = []) {
    const cachedGraphs = cpuGraphActors.get(coreBox);
    if (cachedGraphs) {
        for (const graph of cachedGraphs)
            if (graph.get_parent() === coreBox)
                coreBox.remove_child(graph);
    }
    clearBox(coreBox);

    const textColor = themeColors?.text || '#ffffff';
    const secondaryColor = themeColors?.secondaryText || textColor;
    const baseStyle = `color: ${textColor}; font-weight: 500; font-size: 11px;`;
    const subtleStyle = `color: ${secondaryColor}; font-weight: 500; font-size: 11px;`;

    if (showGraph) {
        const temperatures = cpuInfo.coreDetails
            .map(core => Number.parseFloat(core.temp))
            .filter(Number.isFinite);
        const loads = cpuInfo.coreDetails
            .map(core => Number(core.load))
            .filter(Number.isFinite);
        const averageLoad = loads.length > 0
            ? Math.round(loads.reduce((sum, value) => sum + value, 0) / loads.length)
            : null;
        const frequencies = cpuInfo.coreDetails
            .map(core => Number(core.speed))
            .filter(value => Number.isFinite(value) && value > 0);
        const averageFrequency = frequencies.length > 0
            ? Math.round(frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length)
            : null;
        const currentTemperature = temperatures.length > 0 ? Math.round(Math.max(...temperatures)) : null;
        const historicalTemperatures = Array.isArray(cpuInfo.temperatureHistory)
            ? cpuInfo.temperatureHistory.flat().filter(Number.isFinite)
            : [];
        const peakTemperature = historicalTemperatures.length > 0
            ? Math.round(Math.max(...historicalTemperatures))
            : currentTemperature;
        addGraphSummary(coreBox, 'Load', averageLoad === null ? 'N/A' : `${averageLoad}%`,
            averageFrequency === null ? '' : `${averageFrequency} MHz avg`, themeColors, St);
        const graphs = cachedGraphs || [];
        const loadGraph = graphs[0] || addCPUGraph(coreBox, cpuInfo.coreDetails, cpuInfo.loadHistory, themeColors, St, cpuCoreColors);
        if (graphs[0]) {
            coreBox.add_child(loadGraph);
            cpuGraphColors.set(loadGraph, cpuCoreColors);
        }
        updateGraphMotion(loadGraph, cpuInfo.loadHistory, coreBox);
        addGraphSummary(coreBox, cpuInfo.temperatureSource === 'igpu' ? 'Temperature (iGPU)' : 'Temperature',
            currentTemperature === null ? 'N/A' : `${currentTemperature}°C`,
            peakTemperature === null ? '' : `Peak ${peakTemperature}°C`, themeColors, St);
        const temperatureGraph = graphs[1] || addCPUTemperatureGraph(coreBox, cpuInfo.coreDetails, cpuInfo.temperatureHistory, themeColors, St);
        if (graphs[1]) {
            coreBox.add_child(temperatureGraph);
        }
        updateGraphMotion(temperatureGraph, cpuInfo.temperatureHistory, coreBox);
        cpuGraphActors.set(coreBox, [loadGraph, temperatureGraph]);
    }

    const coreNameWidth = cpuInfo.coreDetails.reduce((width, core) => Math.max(width, core.name.length * 7), 50);
    if (cpuInfo.coreDetails.length) {
        const header = new St.BoxLayout({ x_expand: true, style: 'padding: 5px 9px 4px;' });
        for (const [text, width] of [['Core', coreNameWidth + 14], ['Frequency', 80], ['Load', 78], ['Temp', 60]])
            addCpuCell(header, text, subtleStyle, width, St, true);
        coreBox.add_child(header);
    }
    for (let coreIndex = 0; coreIndex < cpuInfo.coreDetails.length; coreIndex++) {
        const core = cpuInfo.coreDetails[coreIndex];
        const load = Number.isFinite(core.load) ? core.load : 0;
        const tempNumber = parseFloat(core.temp);
        const coreColor = getCoreGraphCssColor(coreIndex, cpuCoreColors);
        const loadColor = getGreenToRedColor(load, { medium: 50, warm: 70, hot: 90 });
        const tempColor = Number.isFinite(tempNumber)
            ? getGraphCssColor(getTemperatureGraphColor(tempNumber))
            : secondaryColor;

        const row = new St.BoxLayout({
            ...horizontalBox,
            x_expand: true,
            style: 'padding: 4px 9px; margin-bottom: 3px;'
        });

        const coreCell = new St.BoxLayout({ width: coreNameWidth + 14, x_expand: true, style: 'spacing: 6px;' });
        coreCell.add_child(new St.Widget({
            width: 8,
            height: 8,
            y_align: Clutter.ActorAlign.CENTER,
            style: `border-radius: 4px; background-color: ${coreColor};`
        }));
        addCpuCell(coreCell, core.name, baseStyle, coreNameWidth, St);
        row.add_child(coreCell);
        addCpuCell(row, `${core.speed} MHz`, subtleStyle, 80, St, true);
        const loadCell = new St.BoxLayout({ width: 78, x_expand: true });
        addMetricBar(loadCell, load, loadColor, St, 34);
        addCpuCell(loadCell, `${load}%`, `${baseStyle} color: ${loadColor};`, 34, St);
        row.add_child(loadCell);
        addCpuCell(row, `${core.temp} °C`, `${baseStyle} color: ${tempColor};`, 60, St, true);
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
    const baseStyle = `color: ${textColor}; font-weight: 500; font-size: 11px;`;
    const subtleStyle = `color: ${secondaryColor}; font-weight: 500; font-size: 11px;`;
    const row = new St.BoxLayout({
        ...horizontalBox,
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
    const baseStyle = `color: ${textColor}; font-weight: 500; font-size: 11px;`;
    const subtleStyle = `color: ${secondaryColor}; font-weight: 500; font-size: 11px;`;
    const row = new St.BoxLayout({
        ...horizontalBox,
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

function setGPURows(gpuBox, gpuInfo, themeColors, St, gpuMemoryHistory = [], gpuTemperatureHistory = [], gpuLoadHistory = [], showGraph = true, gpuHistories = []) {
    const cachedGraphs = gpuGraphActors.get(gpuBox);
    if (cachedGraphs) {
        for (const graph of cachedGraphs.values())
            if (graph.get_parent() === gpuBox)
                gpuBox.remove_child(graph);
    }
    clearBox(gpuBox);

    const { textColor } = sectionTextColors(themeColors);
    const titleStyle = `color: ${textColor}; font-weight: 600; font-size: 12px;`;
    const entries = gpuInfo.split(/\n\s*\n/).map(entry => entry.trim()).filter(Boolean);
    const activeGraphs = new Set();

    for (const [gpuIndex, entry] of entries.entries()) {
        const history = gpuHistories[gpuIndex] ?? { memory: gpuMemoryHistory, temperature: gpuTemperatureHistory, load: gpuLoadHistory };
        const lines = entry.split('\n').map(line => line.trim()).filter(Boolean);
        const header = lines[0]?.match(/^GPU(\d+)\s+-\s+\[\s*(.+?)\s*\]$/);
        if (!header)
            continue;

        gpuBox.add_child(new St.Label({
            text: `GPU ${header[1]} · ${header[2]}`,
            style: `${titleStyle} padding: 0 0 2px;`
        }));

        const graphId = entry.match(/^Device:\s*(.+)$/m)?.[1] ?? gpuIndex;
        for (const metric of ['load', 'memory', 'temperature'])
            activeGraphs.add(`${metric}-${graphId}`);
        const body = lines.slice(1).join(' ');
        const vram = body.match(/VRAM:\s*([\d.]+MB)\s*\/\s*([\d.]+MB)\s*\|\s*([\d.]+)%/);
        const videoMemory = body.match(/Memory Usage:\s*([\d.]+\s*MB)\s*\/\s*([\d.]+\s*GB)\s*\|\s*([\d.]+)%/);
        const temp = body.match(/Temp:\s*([\d.]+)\s*°C/);
        const clock = body.match(/Clockspeed:\s*([\d.]+)(?:\s*\/\s*([\d.]+))?\s*MHz/);
        const frequency = body.match(/GPU Frequency:\s*([\d.]+)\s*MHz/);
        const utilization = body.match(/GPU Utilization:\s*([\d.]+)%/);

        if (utilization) {
            const currentFrequency = frequency?.[1] || clock?.[1];
            const loadSummary = { label: 'Load', value: `${utilization[1]}%`,
                detail: currentFrequency ? `${Number(currentFrequency).toFixed(0)} MHz` : '' };
            if (showGraph)
                addGpuGraph(gpuBox, `GPU${header[1]} Load`, history.load, 'load', themeColors, St, '%', 100, `load-${graphId}`, loadSummary);
            else
                addGraphSummary(gpuBox, loadSummary.label, loadSummary.value, loadSummary.detail, themeColors, St);
        }
        if (showGraph && videoMemory) {
            addGpuGraph(gpuBox, 'Memory Usage', history.memory, 'memory', themeColors, St, '%', 100, `memory-${graphId}`,
                { label: 'Memory', value: `${videoMemory[3]}%`, detail: `${videoMemory[1]} / ${videoMemory[2]}` });
        } else if (showGraph && vram) {
            addGpuGraph(gpuBox, 'VRAM Usage', history.memory, 'memory', themeColors, St, '%', 100, `memory-${graphId}`,
                { label: 'VRAM', value: `${vram[3]}%`, detail: `${vram[1]} / ${vram[2]}` });
        }
        if (showGraph && temp)
            addGpuGraph(gpuBox, 'GPU Temperature', history.temperature, 'temperature', themeColors, St, '°C', 100, `temperature-${graphId}`);
        if (!showGraph && (videoMemory || vram)) {
            const memory = videoMemory || vram;
            const percent = parseFloat(memory[3]);
            addGpuMetricRow(gpuBox, {
                name: videoMemory ? 'Memory' : 'VRAM',
                value: `${memory[1]} / ${memory[2]}`,
                percent,
                color: getGreenToRedColor(percent, { medium: 50, warm: 70, hot: 90 })
            }, themeColors, St);
        }
        const detailRows = [];
        if (temp && !showGraph) {
            const tempValue = parseFloat(temp[1]);
            detailRows.push({
                name: 'Temp',
                value: `${temp[1]} °C`,
                color: getGraphCssColor(getGpuGraphColor(tempValue, 'temperature')),
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
        if (frequency && !utilization) {
            const current = parseFloat(frequency[1]);
            detailRows.push({
                name: 'GPU Frequency',
                value: `${frequency[1]} MHz`,
                color: getGreenToRedColor(Math.min(100, current / 20), { medium: 50, warm: 70, hot: 90 }),
                nameWidth: 92,
                valueWidth: 78
            });
        }
        addGpuDetailRow(gpuBox, detailRows, themeColors, St);
    }
    if (cachedGraphs) {
        for (const [key, graph] of cachedGraphs) {
            if (!activeGraphs.has(key)) {
                graph.destroy();
                cachedGraphs.delete(key);
            }
        }
    }
}

export function updateCPUData({ cpuName, coreBox, showGraph = true, cpuCoreColors = [], sampleInterval = 2500, animationsEnabled = true }, cpuInfo, themeColors, St) {
    if (!St && themeColors?.Label) {
        St = themeColors;
        themeColors = null;
    }

    const labelStyle = detailLabelStyle(themeColors);
    const helpStyle = helpLabelStyle(themeColors);

    if (cpuName && cpuInfo)
        cpuName.text = `${cpuInfo.cpu} x ${cpuInfo.core}`;
    if (coreBox && cpuInfo && Array.isArray(cpuInfo.coreDetails)) {
        graphOptions.set(coreBox, { interval: sampleInterval, enabled: animationsEnabled });
        setCPURows(coreBox, cpuInfo, themeColors, St, showGraph, cpuCoreColors);
    } else if (coreBox && cpuInfo && cpuInfo.coreSpeeds) {
        const lines = cpuInfo.coreSpeeds.map(text => ({ text, style: labelStyle }));
        if (cpuInfo.cpu === 'Unknown CPU' || cpuInfo.core === 0)
            lines.push({ text: TOOL_HELP.cpuInfo, style: helpStyle });
        else if (cpuInfo.coreSpeeds.some(line => line.includes('N/A')))
            lines.push({ text: TOOL_HELP.cpuTemp, style: helpStyle });

        setBoxLines(coreBox, lines, themeColors, St);
    }
}

function createUsageBar(percent, color, themeColors, St, width = 46) {
    const track = new St.BoxLayout({ width, height: 5, y_align: Clutter.ActorAlign.CENTER,
        style: `border-radius: 3px; background-color: ${themeColors?.isDark === false ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.14)'};` });
    track.add_child(new St.Widget({ width: Math.round(Math.max(0, Math.min(100, percent)) / 100 * width),
        height: 5, style: `border-radius: 3px; background-color: ${color};` }));
    return track;
}

function createUsageRing(percent, color, themeColors, St) {
    const ring = new St.DrawingArea({ width: 34, height: 34, y_align: Clutter.ActorAlign.CENTER });
    ring.connect('repaint', area => {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const radius = Math.min(width, height) / 2 - 3;
        cr.setLineWidth(4);
        const track = themeColors?.isDark === false ? 0 : 1;
        cr.setSourceRGBA(track, track, track, 0.14);
        cr.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
        cr.stroke();
        if (percent > 0) {
            const [red, green, blue] = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255);
            cr.setSourceRGB(red, green, blue);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.arc(width / 2, height / 2, radius, -Math.PI / 2,
                -Math.PI / 2 + Math.min(100, percent) / 100 * Math.PI * 2);
            cr.stroke();
        }
    });
    return ring;
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
        const ramColor = getGreenToRedColor(ramPercent, { medium: 50, warm: 70, hot: 90 });
        const row = new St.BoxLayout({ x_expand: true, style: 'spacing: 10px; padding-top: 2px;' });
        const ring = createUsageRing(ramPercent, ramColor, themeColors, St);
        row.add_child(ring);
        const details = new St.BoxLayout({ ...verticalBox,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 4px;' });
        const ramRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px;' });
        const { baseStyle, subtleStyle, textColor } = sectionTextColors(themeColors);
        ramRow.add_child(new St.Label({ text: 'RAM',
            style: `color: ${textColor}; font-weight: 600; font-size: 11px;` }));
        ramRow.add_child(new St.Label({ text: `${memoryInfo.use} / ${memoryInfo.max}`,
            style: baseStyle }));
        ramRow.add_child(new St.Label({ text: `${Math.round(ramPercent)}%`,
            style: `color: ${ramColor}; font-weight: 600; font-size: 11px;` }));
        details.add_child(ramRow);
        row.add_child(details);
        memoryBox.add_child(row);

        details.add_child(new St.Label({
            text: `Swap ${memoryInfo.swapUse} / ${memoryInfo.swapMax}  ·  Cache ${memoryInfo.cache}`,
            style: subtleStyle,
        }));
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
        if (memoryUse) memoryUse.text = `${memoryInfo.loadMarker} [ ${memoryInfo.use} / ${memoryInfo.max} ] [${memoryInfo.percent}]`;
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
            const { baseStyle, subtleStyle, textColor } = sectionTextColors(themeColors);
            for (const entry of entries) {
                const accentColor = getGreenToRedColor(entry.percent, { medium: 55, warm: 72, hot: 90 });
                const row = new St.BoxLayout({ x_expand: true,
                    style: 'spacing: 7px; padding: 1px 0;', y_align: Clutter.ActorAlign.CENTER });
                row.add_child(new St.Label({ text: entry.mount, width: 62,
                    style: `color: ${textColor}; font-weight: 600; font-size: 11px;`,
                    y_align: Clutter.ActorAlign.CENTER }));
                row.add_child(new St.Label({ text: `${entry.used} / ${entry.size}`, width: 84,
                    style: baseStyle, y_align: Clutter.ActorAlign.CENTER }));
                row.add_child(createUsageBar(entry.percent, accentColor, themeColors, St));
                row.add_child(new St.Label({ text: `${Math.round(entry.percent)}%`, width: 28,
                    style: `color: ${accentColor}; font-weight: 600; font-size: 11px;`,
                    y_align: Clutter.ActorAlign.CENTER }));
                row.add_child(new St.Label({ text: `${entry.available} free`, style: subtleStyle,
                    y_align: Clutter.ActorAlign.CENTER }));
                storageBox.add_child(row);
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
            const powerColor = getBatteryColor(parsed.percent, parsed.state, themeColors);
            const { textColor, subtleStyle } = sectionTextColors(themeColors);
            const details = new St.BoxLayout({ ...verticalBox,
                x_expand: true, style: 'spacing: 4px; padding-top: 2px;' });
            const row = new St.BoxLayout({ style: 'spacing: 8px;' });
            row.add_child(new St.Label({ text: parsed.state || 'Battery',
                style: `color: ${textColor}; font-weight: 600; font-size: 11px;` }));
            row.add_child(createUsageBar(parsed.percent, powerColor, themeColors, St, 64));
            row.add_child(new St.Label({ text: `${Math.round(parsed.percent)}%`,
                style: `color: ${powerColor}; font-weight: 600; font-size: 11px;` }));
            details.add_child(row);
            const wattage = parsed.wattage ? parsed.wattage.replace(/W$/, ' W') : 'N/A';
            const time = parsed.time
                ? `${parsed.time} ${/^charging$/i.test(parsed.state) ? 'to full' : 'remaining'}`
                : 'Time unavailable';
            details.add_child(new St.Label({ text: `Power ${wattage}  ·  ${time}`, style: subtleStyle }));
            powerBox.add_child(details);
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
    if (device_OS) device_OS.text = `${systemInfo.osName} [${systemInfo.osType}]`;
    if (device_Kernel) device_Kernel.text = `Kernel : Linux ${systemInfo.kernelVersion}`;
}

export function updateDeviceData({ deviceWithUptime }, uptime) {
    if (deviceWithUptime) deviceWithUptime.text = uptime;
}

export function updateGPUData({
    gpuBox, gpuHead, gpuMemoryHistory = [], gpuTemperatureHistory = [], gpuLoadHistory = [],
    gpuHistories = [], showGraph = true, sampleInterval = 5000, animationsEnabled = true
}, gpuInfo, themeColors, St) {
    if (gpuBox) {
        graphOptions.set(gpuBox, { interval: sampleInterval, enabled: animationsEnabled });
        if (gpuHead)
            gpuHead.set_style(`color: ${themeColors.secondaryText}; font-weight: 600; font-size: 13px;`);
        const detailStyle = `color: ${themeColors.text}; font-weight: 500; font-size: 11px;`;
        if (St && gpuInfo) {
            setGPURows(gpuBox, gpuInfo, themeColors, St, gpuMemoryHistory, gpuTemperatureHistory, gpuLoadHistory, showGraph, gpuHistories);
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
