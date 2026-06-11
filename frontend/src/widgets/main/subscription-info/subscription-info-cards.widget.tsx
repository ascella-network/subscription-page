import { IconArrowsUpDown, IconCalendar, IconCheck, IconUserScan, IconX } from '@tabler/icons-react'
import { Box, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import clsx from 'clsx'

import { useSubscription } from '@entities/subscription-info-store'
import { formatDate } from '@shared/utils/config-parser'
import { useTranslation } from '@shared/hooks'

import classes from './subscription-info-cards.module.css'

type Tone = 'danger' | 'neutral' | 'success'

const toneClasses: Record<Tone, string | undefined> = {
    neutral: undefined,
    success: classes.iconTileSuccess,
    danger: classes.iconTileDanger
}

interface CardItemProps {
    icon: React.ReactNode
    label: string
    tone?: Tone
    value: string
}

const CardItem = ({ icon, label, value, tone = 'neutral' }: CardItemProps) => {
    return (
        <Box className={classes.cardItem}>
            <Group gap="xs" wrap="nowrap">
                <Box className={clsx(classes.iconTile, toneClasses[tone])}>{icon}</Box>
                <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                    <Text
                        c="dimmed"
                        className={classes.label}
                        fw={500}
                        lh={1}
                        size="xs"
                        tt="uppercase"
                    >
                        {label}
                    </Text>
                    <Text className={classes.value} fw={600} size="sm">
                        {value}
                    </Text>
                </Stack>
            </Group>
        </Box>
    )
}

interface IProps {
    isMobile: boolean
}

export const SubscriptionInfoCardsWidget = ({ isMobile: _ }: IProps) => {
    const { t, currentLang, baseTranslations } = useTranslation()
    const subscription = useSubscription()

    const { user } = subscription

    const isActive = user.userStatus === 'ACTIVE'
    const statusText = isActive ? t(baseTranslations.active) : t(baseTranslations.inactive)

    const bandwidthValue =
        user.trafficLimit === '0'
            ? `${user.trafficUsed} / ∞`
            : `${user.trafficUsed} / ${user.trafficLimit}`

    return (
        <SimpleGrid cols={{ base: 1, xs: 1, sm: 2 }} spacing="xs" verticalSpacing="xs">
            <CardItem
                icon={<IconUserScan size={18} />}
                label={t(baseTranslations.name)}
                value={user.username}
            />

            <CardItem
                icon={isActive ? <IconCheck size={18} /> : <IconX size={18} />}
                label={t(baseTranslations.status)}
                tone={isActive ? 'success' : 'danger'}
                value={statusText}
            />

            <CardItem
                icon={<IconCalendar size={18} />}
                label={t(baseTranslations.expires)}
                value={formatDate(user.expiresAt, currentLang, baseTranslations)}
            />

            <CardItem
                icon={<IconArrowsUpDown size={18} />}
                label={t(baseTranslations.bandwidth)}
                value={bandwidthValue}
            />
        </SimpleGrid>
    )
}
