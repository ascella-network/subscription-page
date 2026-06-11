// import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'
// import { visualizer } from 'rollup-plugin-visualizer'
// import deadFile from 'vite-plugin-deadfile'
import removeConsole from 'vite-plugin-remove-console'
import webfontDownload from 'vite-plugin-webfont-dl'
import { existsSync, readFileSync } from 'node:fs'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig, type Plugin } from 'vite'
import { ViteEjsPlugin } from 'vite-plugin-ejs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react-swc'
import 'dotenv/config'

// Dev-only: serve the subscription-page config (normally provided by the
// backend) from frontend/.dev/app-config.json so `npm run start:dev` works
// without a running panel. Has no effect on builds.
const devAppConfigPlugin = (): Plugin => ({
    name: 'dev-app-config',
    configureServer(server) {
        server.middlewares.use('/assets/.app-config-v2.json', (_req, res) => {
            const configPath = fileURLToPath(new URL('./.dev/app-config.json', import.meta.url))

            if (!existsSync(configPath)) {
                res.statusCode = 404
                res.end(
                    'Local dev config missing: put a subscription-page config into frontend/.dev/app-config.json'
                )
                return
            }

            res.setHeader('content-type', 'application/json')
            res.end(readFileSync(configPath))
        })
    }
})

export default defineConfig({
    plugins: [
        react(),
        tsconfigPaths(),
        removeConsole(),
        devAppConfigPlugin(),
        webfontDownload(undefined, {}),
        ViteEjsPlugin((viteConfig) => {
            if (process.env.NODE_ENV === 'production') {
                return {
                    root: viteConfig.root,
                    panelData: '<%- panelData %>',
                    metaDescription: '<%= metaDescription %>',
                    metaTitle: '<%= metaTitle %>'
                }
            }
            return {
                root: viteConfig.root,
                panelData: process.env.PANEL_DATA,
                metaDescription: process.env.META_DESCRIPTION,
                metaTitle: process.env.META_TITLE
            }
        })
        // obfuscatorPlugin({
        //     exclude: [/node_modules/, /app.tsx/],
        //     apply: 'build',
        //     debugger: false,
        //     options: {
        //         compact: true,
        //         controlFlowFlattening: false,
        //         deadCodeInjection: false,
        //         debugProtection: true,
        //         debugProtectionInterval: 0,
        //         domainLock: [],
        //         disableConsoleOutput: true,
        //         identifierNamesGenerator: 'hexadecimal',
        //         log: false,
        //         numbersToExpressions: false,
        //         renameGlobals: false,
        //         selfDefending: false,
        //         simplify: true,
        //         splitStrings: false,
        //         stringArray: true,
        //         stringArrayCallsTransform: false,
        //         stringArrayCallsTransformThreshold: 0.5,
        //         stringArrayEncoding: [],
        //         stringArrayIndexShift: true,
        //         stringArrayRotate: true,
        //         stringArrayShuffle: true,
        //         stringArrayWrappersCount: 1,
        //         stringArrayWrappersChainedCalls: true,
        //         stringArrayWrappersParametersMaxCount: 2,
        //         stringArrayWrappersType: 'variable',
        //         stringArrayThreshold: 0.75,
        //         unicodeEscapeSequence: false
        //         // ...  [See more options](https://github.com/javascript-obfuscator/javascript-obfuscator)
        //     }
        // })
        // visualizer()
    ],
    optimizeDeps: {
        include: ['html-parse-stringify']
    },

    build: {
        target: 'esNext',

        outDir: 'dist',
        rollupOptions: {
            output: {
                manualChunks: {
                    icons: ['react-icons/pi', '@tabler/icons-react'],
                    date: ['dayjs'],
                    react: [
                        'react',
                        'zustand',
                        'react-dom',
                        'react-router-dom',
                        'react-error-boundary',
                        'react-dom/client'
                    ],
                    mantine: [
                        '@mantine/core',
                        '@mantine/hooks',
                        '@mantine/nprogress',
                        '@mantine/notifications',
                        '@mantine/modals'
                    ],
                    i18n: [
                        'i18next-browser-languagedetector',
                        '@remnawave/backend-contract',
                        '@remnawave/subscription-page-types'
                    ]
                }
            }
        }
    },
    server: {
        host: '0.0.0.0',
        port: 3334,
        cors: false,
        strictPort: true,
        allowedHosts: true
    },
    resolve: {
        alias: {
            '@entities': fileURLToPath(new URL('./src/entities', import.meta.url)),
            '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
            '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
            '@widgets': fileURLToPath(new URL('./src/widgets', import.meta.url)),
            '@public': fileURLToPath(new URL('./public', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
        }
    }
})
