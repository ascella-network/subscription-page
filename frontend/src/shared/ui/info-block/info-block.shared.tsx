import { Box, Group, Stack, Text, ThemeIcon } from '@mantine/core'

import { IInfoBlockProps } from './interfaces/props.interface'
import classes from './info-block.module.css'

export const InfoBlockShared = ({ color, icon, title, value }: IInfoBlockProps) => {
    return (
        <Box className={classes.infoBlock}>
            <Stack gap={4}>
                <Group gap={4} wrap="nowrap">
                    <ThemeIcon c={color} radius="sm" size="xs" variant="transparent">
                        {icon}
                    </ThemeIcon>
                    <Text c="dimmed" fw={500} size="xs" truncate>
                        {title}
                    </Text>
                </Group>
                <Text fw={600} size="sm" truncate>
                    {value}
                </Text>
            </Stack>
        </Box>
    )
}
