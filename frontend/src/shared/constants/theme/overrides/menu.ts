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
        }
    })
}
