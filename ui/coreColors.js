const CORE_COLORS = [
    '#944df2', '#5940f2', '#407aff', '#38b8ff', '#33e6e0', '#2ed18c',
    '#73e040', '#c7eb2e', '#ffd12e', '#ff991f', '#ff6129', '#f22947'
];

export function getCpuCoreColor(index) {
    if (index < CORE_COLORS.length)
        return CORE_COLORS[index];

    // Spread hues and brightness without changing a core's color on refresh.
    const hue = (index * 0.618033988749895 % 1) * 6;
    const saturation = 0.60 + (index * 0.414213562373095 % 1) * 0.25;
    const value = 0.85 + (index * 0.732050807568877 % 1) * 0.15;
    const chroma = value * saturation;
    const secondary = chroma * (1 - Math.abs(hue % 2 - 1));
    const channels = [
        [chroma, secondary, 0], [secondary, chroma, 0],
        [0, chroma, secondary], [0, secondary, chroma],
        [secondary, 0, chroma], [chroma, 0, secondary]
    ][Math.floor(hue)];
    return '#' + channels.map(channel => Math.round((channel + value - chroma) * 255)
        .toString(16).padStart(2, '0')).join('');
}
