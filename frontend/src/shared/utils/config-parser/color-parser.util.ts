const COLORS: Record<string, [number, number, number]> = {
    cyan: [34, 211, 238],
    teal: [32, 201, 151],
    green: [64, 192, 87],
    lime: [130, 201, 30],
    yellow: [250, 176, 5],
    orange: [253, 126, 20],
    red: [250, 82, 82],
    pink: [230, 73, 128],
    grape: [190, 75, 219],
    violet: [151, 117, 250],
    indigo: [92, 124, 250],
    blue: [34, 139, 230],
    gray: [161, 161, 170],
    dark: [113, 113, 122]
}

const DEFAULT_COLOR = COLORS.gray

const hexToRgb = (hex: string): [number, number, number] | null => {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : null
}

const getRgb = (color: string): [number, number, number] =>
    COLORS[color] ?? hexToRgb(color) ?? DEFAULT_COLOR

export interface ColorGradientStyle {
    background: string
    border: string
    boxShadow?: string
}

// Flat alpha tints of the config-provided color: hue stays informative,
// gradients and glows stay out
export const getColorGradient = (color: string): ColorGradientStyle => {
    const [r, g, b] = getRgb(color)
    return {
        background: `rgba(${r},${g},${b},0.1)`,
        border: `1px solid rgba(${r},${g},${b},0.16)`
    }
}

export const getColorGradientSolid = (color: string): ColorGradientStyle => {
    const [r, g, b] = getRgb(color)

    return {
        background: `rgba(${r},${g},${b},0.12)`,
        border: `1px solid rgba(${r},${g},${b},0.35)`
    }
}
