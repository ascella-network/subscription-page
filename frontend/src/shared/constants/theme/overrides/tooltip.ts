import { Tooltip } from '@mantine/core'

export default {
    Tooltip: Tooltip.extend({
        defaultProps: {
            radius: 'md',
            withArrow: false,
            transitionProps: { transition: 'fade', duration: 150 },
            color: 'gray'
        }
    })
}
