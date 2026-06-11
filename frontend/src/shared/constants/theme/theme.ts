import { createTheme } from '@mantine/core'

import components from './overrides'

export const theme = createTheme({
    components,
    cursorType: 'pointer',
    // Landing parity: Museo Sans is the brand face (when locally available),
    // Mulish is the free Google fallback; extra fallbacks cover fa/zh/flags
    fontFamily:
        "'Twemoji Country Flags', 'Museo Sans', 'Museo Sans Rounded', Mulish, Vazirmatn, 'Apple Color Emoji', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    breakpoints: {
        xs: '25em',
        sm: '30em',
        md: '48em',
        lg: '64em',
        xl: '80em',
        '2xl': '96em',
        '3xl': '120em',
        '4xl': '160em'
    },
    scale: 1,
    fontSmoothing: true,
    white: '#ffffff',
    // Near-black instead of pure #000 — softer at the same legibility (landing parity)
    black: '#1a1b1e',
    colors: {
        // Ascella brand ramp (#FB7BE2), shared with the ascella.cloud landing
        brand: [
            '#fff0fb',
            '#fbddf2',
            '#f3b8e1',
            '#ec90cf',
            '#e66ec0',
            '#e358b7',
            '#fb7be2',
            '#c83fa1',
            '#b3348f',
            '#9d287d'
        ]
    },
    radius: {
        xs: '0.25rem',
        sm: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem'
    },
    // Shade 8 (not 6/7) so filled CTAs and light-variant text clear 4.5:1 on the
    // light surface — same rationale as the landing theme
    primaryShade: 8,
    primaryColor: 'brand',
    autoContrast: true,
    luminanceThreshold: 0.45,
    headings: {
        fontFamily:
            "'Twemoji Country Flags', 'Museo Sans', 'Museo Sans Rounded', Mulish, Vazirmatn, 'Apple Color Emoji', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        fontWeight: '800'
    },
    defaultRadius: 'md'
})
