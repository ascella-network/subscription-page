/* Points the favicon at the panel-configured logo. Skips the stock Remnawave
   logo (hosted on docs.rw) — same custom-logo check as the page header. */
export function applyBrandingFavicon(logoUrl: string): void {
    if (!logoUrl || logoUrl.includes('docs.rw')) return

    document
        .querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
        .forEach((link) => link.remove())

    const icon = document.createElement('link')
    icon.rel = 'icon'
    icon.href = logoUrl
    document.head.appendChild(icon)

    const appleTouchIcon = document.createElement('link')
    appleTouchIcon.rel = 'apple-touch-icon'
    appleTouchIcon.href = logoUrl
    document.head.appendChild(appleTouchIcon)
}
