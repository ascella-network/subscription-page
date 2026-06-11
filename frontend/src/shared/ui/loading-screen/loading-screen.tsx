import { Box, Center, Group, Stack } from '@mantine/core'
import clsx from 'clsx'

import classes from './loading-screen.module.css'

const Bone = ({ circle, h, w }: { circle?: boolean; h: number | string; w?: number | string }) => (
    <Box className={clsx(classes.skeleton, circle && classes.circle)} h={h} w={w} />
)

export function LoadingScreen({ height = '100%' }: { height?: string }) {
    return (
        <Center h={height}>
            <Stack className={classes.wrapper} gap="xl">
                <Group justify="space-between">
                    <Group gap="sm">
                        <Bone circle h={32} w={32} />
                        <Bone h={16} w={128} />
                    </Group>
                    <Bone h={44} w={44} />
                </Group>

                <Box className={classes.grid}>
                    <Bone h={60} />
                    <Bone h={60} />
                    <Bone h={60} />
                    <Bone h={60} />
                </Box>

                <Bone h={280} />
            </Stack>
        </Center>
    )
}
