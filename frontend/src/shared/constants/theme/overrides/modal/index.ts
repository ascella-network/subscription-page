import { Modal } from '@mantine/core'

import classes from './modal.module.css'

export default {
    Modal: Modal.extend({
        classNames: classes,
        defaultProps: {
            radius: 'lg',
            overlayProps: {
                backgroundOpacity: 0.6,
                blur: 4
            }
        }
    })
}
