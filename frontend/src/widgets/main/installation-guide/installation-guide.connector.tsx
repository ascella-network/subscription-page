import {
    TSubscriptionPageAppConfig,
    TSubscriptionPageButtonConfig,
    TSubscriptionPagePlatformKey
} from '@remnawave/subscription-page-types'
import {
    Box,
    Button,
    ButtonVariant,
    Card,
    Group,
    Select,
    Stack,
    Title,
    UnstyledButton
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconStarFilled } from '@tabler/icons-react'
import { useClipboard } from '@mantine/hooks'
import { useState } from 'react'
import clsx from 'clsx'

import { constructSubscriptionUrl } from '@shared/utils/construct-subscription-url'
import { useSubscription } from '@entities/subscription-info-store'
import { getIconFromLibrary } from '@shared/utils/config-parser'
import { TemplateEngine } from '@shared/utils/template-engine'
import { useAppConfig } from '@entities/app-config-store'
import { vibrate } from '@shared/utils/vibrate'
import { useTranslation } from '@shared/hooks'

import { IBlockRendererProps } from './components/blocks/renderer-block.interface'
import classes from './installation-guide.module.css'

export type TBlockVariant = 'accordion' | 'cards' | 'minimal' | 'timeline'

interface IProps {
    BlockRenderer: React.ComponentType<IBlockRendererProps>
    hasPlatformApps: Record<TSubscriptionPagePlatformKey, boolean>
    isMobile: boolean
    platform: TSubscriptionPagePlatformKey | undefined
}

export const InstallationGuideConnector = (props: IProps) => {
    const { isMobile, hasPlatformApps, BlockRenderer, platform } = props

    const { t, currentLang, baseTranslations } = useTranslation()

    const { platforms, svgLibrary } = useAppConfig()
    const { copy } = useClipboard({ timeout: 2_000 })
    const subscription = useSubscription()

    const [selectedAppIndex, setSelectedAppIndex] = useState(0)
    const [selectedPlatform, setSelectedPlatform] = useState<TSubscriptionPagePlatformKey>(() => {
        if (platform && hasPlatformApps[platform]) {
            return platform
        }

        const firstAvailable = (
            Object.keys(hasPlatformApps) as TSubscriptionPagePlatformKey[]
        ).find((key) => hasPlatformApps[key])
        return firstAvailable!
    })

    const platformApps = platforms[selectedPlatform]!.apps
    const selectedApp = platformApps[selectedAppIndex] ?? platformApps[0]

    const availablePlatforms = (
        Object.entries(hasPlatformApps) as [TSubscriptionPagePlatformKey, boolean][]
    )
        .filter(([_, hasApps]) => hasApps)
        .map(([platform]) => {
            const platformConfig = platforms[platform]!
            return {
                value: platform,
                label: t(platformConfig.displayName),
                icon: getIconFromLibrary(platformConfig.svgIconKey, svgLibrary)
            }
        })

    const subscriptionUrl = constructSubscriptionUrl(
        window.location.href,
        subscription.user.shortUuid
    )

    const handleButtonClick = (button: TSubscriptionPageButtonConfig) => {
        let formattedUrl: string | undefined

        if (button.type === 'subscriptionLink' || button.type === 'copyButton') {
            formattedUrl = TemplateEngine.formatWithMetaInfo(button.link, {
                username: subscription.user.username,
                subscriptionUrl
            })
        }

        switch (button.type) {
            case 'copyButton': {
                if (!formattedUrl) return

                copy(formattedUrl)
                notifications.show({
                    title: t(baseTranslations.linkCopied),
                    message: t(baseTranslations.linkCopiedToClipboard)
                })
                break
            }
            case 'external': {
                window.open(button.link, '_blank')
                break
            }
            case 'subscriptionLink': {
                if (!formattedUrl) return

                window.open(formattedUrl, '_blank')
                break
            }
            default:
                break
        }
    }

    const renderBlockButtons = (
        buttons: TSubscriptionPageButtonConfig[],
        variant: ButtonVariant
    ) => {
        if (buttons.length === 0) return null

        return (
            <Group gap="xs" wrap="wrap">
                {buttons.map((button, index) => (
                    <Button
                        key={index}
                        leftSection={
                            <span
                                className="svg-recolor"
                                dangerouslySetInnerHTML={{
                                    __html: getIconFromLibrary(button.svgIconKey, svgLibrary)
                                }}
                                style={{ display: 'flex', alignItems: 'center' }}
                            />
                        }
                        onClick={() => handleButtonClick(button)}
                        radius="md"
                        variant={variant}
                    >
                        {t(button.text)}
                    </Button>
                ))}
            </Group>
        )
    }

    const getIcon = (iconKey: string) => getIconFromLibrary(iconKey, svgLibrary)

    return (
        <Card p={{ base: 'sm', xs: 'md', sm: 'lg', md: 'xl' }} radius="lg">
            <Stack gap="md">
                <Group gap="sm" justify="space-between">
                    <Title order={4}>{t(baseTranslations.installationGuideHeader)}</Title>

                    {availablePlatforms.length > 1 && (
                        <Select
                            allowDeselect={false}
                            classNames={{ option: classes.platformOption }}
                            comboboxProps={{ position: 'bottom-end', width: 200 }}
                            data={availablePlatforms.map((opt) => ({
                                value: opt.value,
                                label: opt.label
                            }))}
                            leftSection={
                                <span
                                    className="svg-recolor"
                                    dangerouslySetInnerHTML={{
                                        __html: availablePlatforms.find(
                                            (opt) => opt.value === selectedPlatform
                                        )!.icon
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        width: 20,
                                        height: 20
                                    }}
                                />
                            }
                            onChange={(value) => {
                                if (!value || value === selectedPlatform) return
                                vibrate([80])
                                setSelectedPlatform(value as TSubscriptionPagePlatformKey)
                                setSelectedAppIndex(0)
                            }}
                            radius="md"
                            renderOption={({ option }) => (
                                <>
                                    <span
                                        className={clsx('svg-recolor', classes.platformOptionIcon)}
                                        dangerouslySetInnerHTML={{
                                            __html: availablePlatforms.find(
                                                (opt) => opt.value === option.value
                                            )!.icon
                                        }}
                                    />
                                    <span>{option.label}</span>
                                </>
                            )}
                            size="sm"
                            value={selectedPlatform}
                            w={150}
                            withCheckIcon={false}
                        />
                    )}
                </Group>

                {platformApps.length > 0 && (
                    <Box>
                        <div className={classes.appsGrid}>
                            {platformApps.map((app: TSubscriptionPageAppConfig, index: number) => {
                                const isActive = index === selectedAppIndex
                                const hasIcon = Boolean(app.svgIconKey)

                                return (
                                    <UnstyledButton
                                        className={clsx(
                                            classes.appButton,
                                            isActive && classes.appButtonActive
                                        )}
                                        key={app.name}
                                        onClick={() => {
                                            vibrate('toggle')
                                            setSelectedAppIndex(index)
                                        }}
                                    >
                                        {hasIcon && (
                                            <span
                                                className={clsx(
                                                    'svg-recolor',
                                                    classes.bgIcon,
                                                    isActive && classes.bgIconActive
                                                )}
                                                dangerouslySetInnerHTML={{
                                                    __html: getIconFromLibrary(
                                                        app.svgIconKey!,
                                                        svgLibrary
                                                    )
                                                }}
                                            />
                                        )}
                                        <span className={classes.appName}>{app.name}</span>
                                        {app.featured && (
                                            <IconStarFilled
                                                className={classes.featuredStar}
                                                size={12}
                                            />
                                        )}
                                    </UnstyledButton>
                                )
                            })}
                        </div>

                        {selectedApp && (
                            <BlockRenderer
                                blocks={selectedApp.blocks}
                                currentLang={currentLang}
                                getIconFromLibrary={getIcon}
                                isMobile={isMobile}
                                renderBlockButtons={renderBlockButtons}
                                svgLibrary={svgLibrary}
                            />
                        )}
                    </Box>
                )}
            </Stack>
        </Card>
    )
}
