import { Combobox, Menu } from '@mantine/core'

export default {
    Menu: Menu.extend({
        defaultProps: {
            shadow: 'md',
            withArrow: false,
            transitionProps: { transition: 'fade-down', duration: 150 }
        }
    }),
    Combobox: Combobox.extend({
        defaultProps: {
            shadow: 'md',
            withArrow: false,
            transitionProps: { transition: 'fade-down', duration: 150 }
        },
        styles: {
            dropdown: {
                background: 'var(--mantine-color-white)',
                border: '1px solid rgb(26 27 30 / 0.08)',
                borderRadius: 'var(--mantine-radius-md)'
            }
        }
    })
}
