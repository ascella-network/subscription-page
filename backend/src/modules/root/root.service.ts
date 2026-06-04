import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { nanoid } from 'nanoid';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import { canParseJSON } from '@common/helpers/can-parse-json';
import { AxiosService } from '@common/axios/axios.service';
import { IGNORED_HEADERS } from '@common/constants';
import { sanitizeUsername } from '@common/utils';

import { SubpageConfigService } from './subpage-config.service';

@Injectable()
export class RootService {
    private readonly logger = new Logger(RootService.name);

    private readonly isMarzbanLegacyLinkEnabled: boolean;
    private readonly marzbanSecretKeys: string[];
    private readonly mlDropRevokedSubscriptions: boolean;
    private readonly mergeMihomo: boolean;
    private readonly mergeMihomoProxyGroups: boolean;
    private readonly mergeBase64: boolean;
    private readonly mergeXrayHosts: boolean;
    private readonly mergeXrayOutbounds: boolean;
    private readonly overrideFingerprintPerOs: boolean;
    private readonly mergeHostsPosition: string;
    private readonly appendTrafficLeft: boolean;
    constructor(
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
        private readonly axiosService: AxiosService,
        private readonly subpageConfigService: SubpageConfigService,
    ) {
        this.isMarzbanLegacyLinkEnabled = this.configService.getOrThrow<boolean>(
            'MARZBAN_LEGACY_LINK_ENABLED',
        );
        this.mlDropRevokedSubscriptions = this.configService.getOrThrow<boolean>(
            'MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS',
        );

        const marzbanSecretKeys = this.configService.get<string>('MARZBAN_LEGACY_SECRET_KEY');

        if (marzbanSecretKeys && marzbanSecretKeys.length > 0) {
            this.marzbanSecretKeys = marzbanSecretKeys.split(',').map((key) => key.trim());
        } else {
            this.marzbanSecretKeys = [];
        }

        this.mergeMihomo = this.configService.getOrThrow<boolean>('MERGE_MIHOMO');
        this.mergeMihomoProxyGroups = this.configService.getOrThrow<boolean>(
            'MERGE_MIHOMO_PROXY_GROUPS',
        );
        this.mergeBase64 = this.configService.getOrThrow<boolean>('MERGE_BASE64');
        this.mergeXrayHosts = this.configService.getOrThrow<boolean>('MERGE_XRAY_HOSTS');
        this.mergeXrayOutbounds = this.configService.getOrThrow<boolean>('MERGE_XRAY_OUTBOUNDS');
        this.overrideFingerprintPerOs = this.configService.getOrThrow<boolean>(
            'OVERRIDE_FINGERPRINT_PER_OS',
        );
        this.mergeHostsPosition = this.configService.getOrThrow<string>('MERGE_HOSTS_POSITION');
        this.appendTrafficLeft = this.configService.getOrThrow<boolean>('APPEND_TRAFFIC_LEFT');
    }

    public async serveSubscriptionPage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<void> {
        try {
            const userAgent = req.headers['user-agent'];

            let shortUuidLocal = shortUuid;

            if (this.isGenericPath(req.path)) {
                res.socket?.destroy();
                return;
            }

            if (this.isMarzbanLegacyLinkEnabled) {
                const username = await this.tryDecodeMarzbanLink(shortUuid);

                if (username) {
                    const sanitizedUsername = sanitizeUsername(username.username);

                    this.logger.log(
                        `Decoded Marzban username: ${username.username}, sanitized username: ${sanitizedUsername}`,
                    );

                    const userInfo = await this.axiosService.getUserByUsername(
                        clientIp,
                        sanitizedUsername,
                    );
                    if (!userInfo.isOk || !userInfo.response) {
                        this.logger.error(
                            `Decoded Marzban username is not found in Remnawave, decoded username: ${sanitizedUsername}`,
                        );

                        res.socket?.destroy();
                        return;
                    } else if (
                        this.mlDropRevokedSubscriptions &&
                        userInfo.response.response.subRevokedAt !== null
                    ) {
                        res.socket?.destroy();
                        return;
                    }

                    shortUuidLocal = userInfo.response.response.shortUuid;
                }
            }

            if (userAgent && this.isBrowser(userAgent)) {
                return this.returnWebpage(clientIp, req, res, shortUuidLocal);
            }

            const subscriptionDataResponse = await this.axiosService.getSubscription(
                clientIp,
                shortUuidLocal,
                req.headers,
                !!clientType,
                clientType,
            );

            if (!subscriptionDataResponse) {
                res.socket?.destroy();
                return;
            }

            subscriptionDataResponse.response = await this.mergeLinkedSubscriptions(
                clientIp,
                shortUuid,
                subscriptionDataResponse.response,
                req.headers,
                !!clientType,
                clientType,
                subscriptionDataResponse.headers['content-type'],
            );

            if (this.overrideFingerprintPerOs) {
                const os = this.detectClientOs(req.headers);
                const fp = this.getFingerprintForOs(os);
                const contentType = subscriptionDataResponse.headers['content-type'];

                if (!this.isYamlContentType(contentType)) {
                    this.logger.debug(
                        `Overriding fingerprint for OS "${os ?? 'unknown'}" → "${fp}"`,
                    );
                    subscriptionDataResponse.response = this.applyFingerprintOverride(
                        subscriptionDataResponse.response,
                        fp,
                    );
                }
            }

            if (subscriptionDataResponse.headers) {
                Object.entries(subscriptionDataResponse.headers)
                    .filter(([key]) => !IGNORED_HEADERS.has(key.toLowerCase()))
                    .forEach(([key, value]) => {
                        res.setHeader(key, value);
                    });
            }

            res.status(200).send(subscriptionDataResponse.response);
            return;
        } catch (error) {
            this.logger.error('Error in serveSubscriptionPage', error);

            res.socket?.destroy();
            return;
        }
    }

    private generateJwtForCookie(uuid: string | null): string {
        return this.jwtService.sign(
            {
                sessionId: nanoid(32),
                su: this.subpageConfigService.getEncryptedSubpageConfigUuid(uuid),
            },
            {
                expiresIn: '33m',
            },
        );
    }

    private isBrowser(userAgent: string): boolean {
        const browserKeywords = [
            'Mozilla',
            'Chrome',
            'Safari',
            'Firefox',
            'Opera',
            'Edge',
            'TelegramBot',
            'WhatsApp',
        ];

        return browserKeywords.some((keyword) => userAgent.includes(keyword));
    }

    private isGenericPath(path: string): boolean {
        const genericPaths = [
            'favicon.ico',
            'robots.txt',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.svg',
            '.webp',
            '.ico',
        ];

        return genericPaths.some((genericPath) => path.includes(genericPath));
    }

    private parseAsJsonArray(response: unknown): unknown[] | null {
        if (Array.isArray(response)) {
            return response;
        }

        if (typeof response === 'string' && canParseJSON(response)) {
            const parsed = JSON.parse(response);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }

        return null;
    }

    /** Tags from linked subscriptions that must not be injected into the main config. */
    private readonly FILTERED_OUTBOUND_PROTOCOLS = new Set([
        'blackhole',
        'dns',
        'freedom',
        'loopback',
    ]);

    /** OS key (lowercase) → Reality fingerprint value applied to outbounds/links. */
    private readonly OS_TO_FINGERPRINT: Record<string, string> = {
        ios: 'ios',
        android: 'android',
        macos: 'safari',
        windows: 'firefox',
        linux: 'firefox',
    };

    /** Detects client OS from x-device-os header first, then falls back to User-Agent. */
    private detectClientOs(headers: NodeJS.Dict<string | string[]>): string | null {
        const deviceOsRaw = headers['x-device-os'];
        const deviceOs = Array.isArray(deviceOsRaw) ? deviceOsRaw[0] : deviceOsRaw;

        if (deviceOs) {
            const normalized = deviceOs.toLowerCase();
            for (const key of Object.keys(this.OS_TO_FINGERPRINT)) {
                if (normalized.includes(key)) return key;
            }
        }

        const uaRaw = headers['user-agent'];
        const ua = Array.isArray(uaRaw) ? uaRaw[0] : uaRaw;
        if (!ua) return null;

        if (/iPhone|iPad|iPod|\bios\b/i.test(ua)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        if (/Mac OS X|Macintosh|darwin|\bmacos\b/i.test(ua)) return 'macos';
        if (/Windows|\bwin(?:32|64)\b/i.test(ua)) return 'windows';
        if (/Linux|X11/i.test(ua)) return 'linux';

        return null;
    }

    /** Fallback fingerprint when OS cannot be detected or has no explicit mapping. */
    private readonly DEFAULT_FINGERPRINT = 'firefox';

    /** Returns the configured fingerprint for a given OS key, falling back to firefox. */
    private getFingerprintForOs(os: string | null): string {
        if (!os) return this.DEFAULT_FINGERPRINT;
        return this.OS_TO_FINGERPRINT[os] ?? this.DEFAULT_FINGERPRINT;
    }

    /**
     * Mutates each config's outbounds: sets streamSettings.realitySettings.fingerprint
     * to the given value when realitySettings is present.
     */
    private overrideFingerprintInJsonConfigs(configs: unknown[], fp: string): unknown[] {
        for (const config of configs) {
            const outbounds = (config as Record<string, unknown>)?.outbounds;
            if (!Array.isArray(outbounds)) continue;

            for (const ob of outbounds) {
                const streamSettings = (ob as Record<string, unknown>)?.streamSettings as
                    | Record<string, unknown>
                    | undefined;
                const realitySettings = streamSettings?.realitySettings as
                    | Record<string, unknown>
                    | undefined;
                if (realitySettings) {
                    realitySettings.fingerprint = fp;
                }
            }
        }
        return configs;
    }

    /** Replaces the `fp` query parameter in a vless:// link; returns line unchanged otherwise. */
    private overrideFingerprintInVlessLink(line: string, fp: string): string {
        if (!line.startsWith('vless://')) return line;

        try {
            const url = new URL(line);
            url.searchParams.set('fp', fp);
            return url.toString();
        } catch {
            return line;
        }
    }

    /** Decodes base64 subscription, rewrites fp= in every vless:// line, re-encodes back. */
    private overrideFingerprintInBase64(response: string, fp: string): string {
        const lines = this.decodeBase64Lines(response);
        const updated = lines.map((line) => this.overrideFingerprintInVlessLink(line, fp));
        return Buffer.from(updated.join('\n'), 'utf-8').toString('base64');
    }

    /**
     * Dispatches fingerprint override based on response shape:
     * base64 → vless links rewrite, JSON array/string → outbounds rewrite.
     */
    private applyFingerprintOverride(response: unknown, fp: string): unknown {
        if (typeof response === 'string' && this.isBase64Subscription(response)) {
            return this.overrideFingerprintInBase64(response, fp);
        }

        const isString = typeof response === 'string';
        const arr = this.parseAsJsonArray(response);
        if (!arr) return response;

        const updated = this.overrideFingerprintInJsonConfigs(arr, fp);
        return isString ? JSON.stringify(updated) : updated;
    }

    /**
     * Dispatches merge logic based on content-type:
     * - application/json  → JSON outbounds / hosts merge
     * - text/yaml (Clash) → proxies array merge
     */
    private async mergeLinkedSubscriptions(
        clientIp: string,
        shortUuid: string,
        response: unknown,
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType?: TRequestTemplateTypeKeys,
        contentType?: string,
    ): Promise<unknown> {
        const resolveResult = await this.axiosService.resolveUser({ shortUuid });
        if (!resolveResult.isOk || !resolveResult.response) return response;

        const userUuid = resolveResult.response.response.uuid;

        const metadataResult = await this.axiosService.getUserMetadata(userUuid);
        if (!metadataResult.isOk || !metadataResult.response) return response;

        this.logger.log(`Metadata: ${JSON.stringify(metadataResult.response.response.metadata)}`);

        const metadata = metadataResult.response.response.metadata as Record<string, unknown>;
        const linkedSubs = metadata?.linked_subs;

        if (!Array.isArray(linkedSubs) || linkedSubs.length === 0) return response;

        const args = [clientIp, linkedSubs, headers, withClientType, clientType] as const;

        if (this.isYamlContentType(contentType)) {
            if (!this.mergeMihomo) return response;
            return this.mergeByYamlProxies(...args, response);
        }

        if (typeof response === 'string' && this.isBase64Subscription(response)) {
            if (!this.mergeBase64) return response;
            return this.mergeByBase64Lines(...args, response);
        }

        const isString = typeof response === 'string';
        const mainArray = this.parseAsJsonArray(response);

        if (!mainArray) return response;

        let result: unknown[] = [...mainArray];

        if (this.mergeXrayOutbounds) {
            result = await this.mergeByOutbounds(...args, result);
        }

        if (this.mergeXrayHosts) {
            result = await this.mergeByHosts(...args, result);
        }

        return isString ? JSON.stringify(result) : result;
    }

    /**
     * Returns true when the string is valid base64 that decodes to
     * newline-separated proxy links (e.g. vless://, vmess://, trojan://).
     */
    private isBase64Subscription(response: unknown): boolean {
        if (typeof response !== 'string') return false;
        const trimmed = response.trim();
        if (trimmed.length === 0) return false;
        try {
            const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
            return decoded.includes('://');
        } catch {
            return false;
        }
    }

    /** Decodes a base64 subscription string into an array of non-empty proxy lines. */
    private decodeBase64Lines(response: string): string[] {
        const decoded = Buffer.from(response.trim(), 'base64').toString('utf-8');
        return decoded.split('\n').filter((line) => line.trim().length > 0);
    }

    /**
     * Decodes the main base64 subscription, appends proxy lines from each linked
     * subscription (also decoding base64 if needed), then re-encodes to base64.
     */
    private async mergeByBase64Lines(
        clientIp: string,
        linkedSubs: unknown[],
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType: TRequestTemplateTypeKeys | undefined,
        response: string,
    ): Promise<string> {
        const mainLines = this.decodeBase64Lines(response);
        const linkedLines: string[] = [];

        for (const linkedId of linkedSubs) {
            if (typeof linkedId !== 'number') continue;

            const linkedSub = await this.fetchLinkedSub(
                clientIp,
                linkedId,
                headers,
                withClientType,
                clientType,
            );
            if (!linkedSub) continue;

            const linkedResponse = linkedSub.response;
            if (typeof linkedResponse !== 'string') continue;

            const lines = this.isBase64Subscription(linkedResponse)
                ? this.decodeBase64Lines(linkedResponse)
                : linkedResponse.split('\n').filter((l) => l.trim().length > 0);

            const suffix = this.getTrafficLeftSuffix(linkedSub.headers as Record<string, unknown>);

            for (const line of lines) {
                linkedLines.push(suffix ? this.appendTrafficToVlessLink(line, suffix) : line);
            }
        }

        const merged = this.insertByPosition(mainLines, linkedLines);
        return Buffer.from(merged.join('\n'), 'utf-8').toString('base64');
    }

    /** Returns true when the content-type signals a YAML/Clash subscription. */
    private isYamlContentType(contentType?: string): boolean {
        if (!contentType) return false;
        const ct = contentType.toLowerCase();
        return ct.includes('yaml') || ct.includes('x-yaml') || ct.includes('text/yaml');
    }

    /**
     * Parses a YAML string and returns the document object, or null if parsing fails
     * or the response is not a string.
     */
    private parseAsYamlDoc(response: unknown): Record<string, unknown> | null {
        if (typeof response !== 'string') return null;
        try {
            const doc = yaml.load(response);
            if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
                return doc as Record<string, unknown>;
            }
        } catch {
            // not valid yaml
        }
        return null;
    }

    /** Built-in Clash keywords that are not real proxy names and must not be injected into groups. */
    private readonly CLASH_BUILTIN_KEYWORDS = new Set(['DIRECT', 'GLOBAL', 'PASS', 'REJECT']);

    /**
     * Collects `proxies` entries from all linked YAML subscriptions and injects them
     * into the main Clash config's proxies array. Optionally appends proxy names to
     * proxy-groups when MERGE_MIHOMO_PROXY_GROUPS is enabled.
     */
    private async mergeByYamlProxies(
        clientIp: string,
        linkedSubs: unknown[],
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType: TRequestTemplateTypeKeys | undefined,
        response: unknown,
    ): Promise<unknown> {
        const mainDoc = this.parseAsYamlDoc(response);
        if (!mainDoc) return response;

        if (!Array.isArray(mainDoc.proxies)) {
            mainDoc.proxies = [];
        }

        const newProxies: unknown[] = [];
        const newProxyNames: string[] = [];

        for (const linkedId of linkedSubs) {
            if (typeof linkedId !== 'number') continue;

            const linkedSub = await this.fetchLinkedSub(
                clientIp,
                linkedId,
                headers,
                withClientType,
                clientType,
            );
            if (!linkedSub) continue;

            const linkedDoc = this.parseAsYamlDoc(linkedSub.response);
            if (!linkedDoc || !Array.isArray(linkedDoc.proxies)) continue;

            const suffix = this.getTrafficLeftSuffix(linkedSub.headers as Record<string, unknown>);

            for (const proxy of linkedDoc.proxies) {
                const record = proxy as Record<string, unknown>;

                if (suffix && typeof record.name === 'string') {
                    record.name += suffix;
                }

                newProxies.push(proxy);

                if (typeof record.name === 'string') newProxyNames.push(record.name);
            }
        }

        (mainDoc.proxies as unknown[]).push(...newProxies);

        this.injectProxiesIntoProviders(mainDoc, newProxies);

        if (this.mergeMihomoProxyGroups && newProxyNames.length > 0) {
            this.injectNamesIntoProxyGroups(mainDoc, newProxyNames);
        }

        return yaml.dump(mainDoc, { lineWidth: -1 });
    }

    /**
     * Injects merged proxy nodes into every inline proxy-provider's payload.
     * Remnawave fills these payloads at generation time, so linked proxies must be
     * added here too; each provider's own filter/exclude-filter then matches them.
     */
    private injectProxiesIntoProviders(doc: Record<string, unknown>, proxies: unknown[]): void {
        if (proxies.length === 0) return;

        const providers = doc['proxy-providers'];
        if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return;

        for (const provider of Object.values(
            providers as Record<string, Record<string, unknown>>,
        )) {
            if (!provider || provider.type !== 'inline') continue;

            if (!Array.isArray(provider.payload)) {
                provider.payload = [];
            }

            (provider.payload as unknown[]).push(...proxies);
        }
    }

    /**
     * Pushes proxy names into every proxy-group that already contains
     * at least one non-builtin entry (i.e. a real proxy reference).
     */
    private injectNamesIntoProxyGroups(doc: Record<string, unknown>, names: string[]): void {
        if (!Array.isArray(doc['proxy-groups'])) return;

        for (const group of doc['proxy-groups'] as Record<string, unknown>[]) {
            if (!Array.isArray(group.proxies)) continue;

            const hasRealProxy = (group.proxies as unknown[]).some(
                (p) => typeof p === 'string' && !this.CLASH_BUILTIN_KEYWORDS.has(p),
            );

            if (hasRealProxy) {
                group.proxies = this.insertByPosition(group.proxies as string[], names);
            }
        }
    }

    /** Fetches subscription for each linkedId and returns its short UUID, or null on failure. */
    private async fetchLinkedSub(
        clientIp: string,
        linkedId: number,
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType?: TRequestTemplateTypeKeys,
    ) {
        const linkedResolve = await this.axiosService.resolveUser({ id: linkedId });
        if (!linkedResolve.isOk || !linkedResolve.response) return null;

        const linkedShortUuid = linkedResolve.response.response.shortUuid;
        const linkedSub = await this.axiosService.getSubscription(
            clientIp,
            linkedShortUuid,
            headers,
            withClientType,
            clientType,
        );
        return linkedSub ?? null;
    }

    /**
     * Returns the formatted traffic-left suffix (with a leading space) from the
     * traffic-left header, or null when the feature is disabled, the header is empty,
     * or the value is zero (treated as unlimited).
     */
    private getTrafficLeftSuffix(headers: Record<string, unknown> | undefined): string | null {
        if (!this.appendTrafficLeft || !headers) return null;

        const raw = headers['traffic-left'];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (typeof value !== 'string' || value.trim().length === 0) return null;

        const numeric = parseFloat(value.replace(',', '.'));
        if (numeric === 0) return null;

        return ` ${value.trim()}`;
    }

    /** Appends the suffix to the URL-encoded #fragment (remark) of a proxy link. */
    private appendTrafficToVlessLink(line: string, suffix: string): string {
        const hashIdx = line.indexOf('#');
        if (hashIdx === -1) return line;

        const base = line.slice(0, hashIdx);
        const remark = decodeURIComponent(line.slice(hashIdx + 1));
        return `${base}#${encodeURIComponent(remark + suffix)}`;
    }

    /** Inserts items into the current array at the position set by MERGE_HOSTS_POSITION. */
    private insertByPosition<T>(current: T[], items: T[]): T[] {
        if (items.length === 0) return current;

        switch (this.mergeHostsPosition) {
            case 'start':
                return [...items, ...current];
            case 'middle': {
                const mid = Math.floor(current.length / 2);
                return [...current.slice(0, mid), ...items, ...current.slice(mid)];
            }
            default:
                return [...current, ...items];
        }
    }

    /** Merges full host configs from linked subscriptions into the current array (MERGE_XRAY_HOSTS=true). */
    private async mergeByHosts(
        clientIp: string,
        linkedSubs: unknown[],
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType: TRequestTemplateTypeKeys | undefined,
        current: unknown[],
    ): Promise<unknown[]> {
        const linkedConfigs: unknown[] = [];

        for (const linkedId of linkedSubs) {
            if (typeof linkedId !== 'number') continue;

            const linkedSub = await this.fetchLinkedSub(
                clientIp,
                linkedId,
                headers,
                withClientType,
                clientType,
            );
            if (!linkedSub) continue;

            const linkedArray = this.parseAsJsonArray(linkedSub.response);
            if (!linkedArray) continue;

            const suffix = this.getTrafficLeftSuffix(linkedSub.headers as Record<string, unknown>);

            for (const config of linkedArray) {
                if (suffix) {
                    const record = config as Record<string, unknown>;
                    if (typeof record.remarks === 'string') {
                        record.remarks += suffix;
                    }
                }
                linkedConfigs.push(config);
            }
        }

        return this.insertByPosition(current, linkedConfigs);
    }

    private readonly NULL_UUID = '00000000-0000-0000-0000-000000000000';

    /**
     * Returns true when the outbound is a template placeholder —
     * has `settings.vnext` with a user whose id is the null UUID.
     */
    private isTemplateOutbound(ob: unknown): boolean {
        const settings = (ob as Record<string, unknown>)?.settings as
            | Record<string, unknown>
            | undefined;
        const vnext = settings?.vnext;
        if (!Array.isArray(vnext)) return false;

        return vnext.some((entry: unknown) => {
            const users = (entry as Record<string, unknown>)?.users;
            if (!Array.isArray(users)) return false;
            return users.some(
                (u: unknown) => (u as Record<string, unknown>)?.id === this.NULL_UUID,
            );
        });
    }

    /** Collects all outbound tags already present in a config's outbounds array. */
    private collectExistingTags(config: unknown): Set<string> {
        const tags = new Set<string>();
        const outbounds = (config as Record<string, unknown>).outbounds;
        if (!Array.isArray(outbounds)) return tags;

        for (const ob of outbounds) {
            const tag = (ob as Record<string, unknown>)?.tag as string | undefined;
            if (tag) tags.add(tag);
        }

        return tags;
    }

    /** Injects outbounds from linked subscriptions into each config of the current array (MERGE_XRAY_OUTBOUNDS=true). */
    private async mergeByOutbounds(
        clientIp: string,
        linkedSubs: unknown[],
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType: TRequestTemplateTypeKeys | undefined,
        current: unknown[],
    ): Promise<unknown[]> {
        const seenTags = new Set<string>();
        const extraOutbounds: unknown[] = [];

        for (const linkedId of linkedSubs) {
            if (typeof linkedId !== 'number') continue;

            const linkedSub = await this.fetchLinkedSub(
                clientIp,
                linkedId,
                headers,
                withClientType,
                clientType,
            );
            if (!linkedSub) continue;

            const linkedArray = this.parseAsJsonArray(linkedSub.response);
            if (!linkedArray) continue;

            for (const config of linkedArray) {
                const outbounds = (config as Record<string, unknown>).outbounds;
                if (!Array.isArray(outbounds)) continue;

                for (const ob of outbounds) {
                    const record = ob as Record<string, unknown>;

                    if (this.FILTERED_OUTBOUND_PROTOCOLS.has(record?.protocol as string)) continue;

                    if (this.isTemplateOutbound(ob)) {
                        this.logger.debug(`Skipping template outbound with null UUID`);
                        continue;
                    }

                    const tag = record?.tag as string | undefined;
                    if (tag && seenTags.has(tag)) {
                        this.logger.debug(`Skipping duplicate outbound tag: "${tag}"`);
                        continue;
                    }
                    if (tag) seenTags.add(tag);

                    extraOutbounds.push(ob);
                }
            }
        }

        if (extraOutbounds.length > 0) {
            for (const config of current) {
                const mainTags = this.collectExistingTags(config);
                const outbounds = (config as Record<string, unknown>).outbounds;
                if (!Array.isArray(outbounds)) continue;

                for (const ob of extraOutbounds) {
                    const tag = (ob as Record<string, unknown>)?.tag as string | undefined;
                    if (tag && mainTags.has(tag)) {
                        this.logger.debug(`Skipping outbound tag already in main config: "${tag}"`);
                        continue;
                    }
                    outbounds.push(ob);
                }
            }
        }

        return current;
    }

    private async returnWebpage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
    ): Promise<void> {
        try {
            const subscriptionDataResponse = await this.axiosService.getSubscriptionInfo(
                clientIp,
                shortUuid,
            );

            if (!subscriptionDataResponse.isOk || !subscriptionDataResponse.response) {
                res.socket?.destroy();
                return;
            }

            const subpageConfigResponse = await this.axiosService.getSubpageConfig(
                shortUuid,
                req.headers,
            );

            if (!subpageConfigResponse.isOk || !subpageConfigResponse.response) {
                res.socket?.destroy();
                return;
            }

            const subpageConfig = subpageConfigResponse.response;

            if (subpageConfig.webpageAllowed === false) {
                this.logger.log(`Webpage access is not allowed by Remnawave's SRR.`);
                res.socket?.destroy();
                return;
            }

            const baseSettings = this.subpageConfigService.getBaseSettings(
                subpageConfig.subpageConfigUuid,
            );

            const subscriptionData = subscriptionDataResponse.response;

            if (!baseSettings.showConnectionKeys) {
                subscriptionData.response.links = [];
                subscriptionData.response.ssConfLinks = {};
            }

            res.cookie('session', this.generateJwtForCookie(subpageConfig.subpageConfigUuid), {
                httpOnly: true,
                secure: true,
                maxAge: 1_800_000, // 30 minutes
            });

            res.render('index', {
                metaTitle: baseSettings.metaTitle,
                metaDescription: baseSettings.metaDescription,
                panelData: Buffer.from(JSON.stringify(subscriptionData)).toString('base64'),
            });
        } catch (error) {
            this.logger.error(`Error in returnWebpage: ${error}`);

            res.socket?.destroy();
            return;
        }
    }

    private async tryDecodeMarzbanLink(shortUuid: string): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (!this.marzbanSecretKeys.length) return null;

        const token = shortUuid;
        this.logger.debug(`Verifying token: ${token}`);

        if (!token || token.length < 10) {
            this.logger.debug(`Token too short: ${token}`);
            return null;
        }

        for (const key of this.marzbanSecretKeys) {
            const result = await this.decodeMarzbanLink(shortUuid, key);
            if (result) return result;

            this.logger.debug(`Decoding Marzban link failed with key: ${key}`);
        }

        this.logger.debug(`Decoding Marzban link failed with all keys`);

        return null;
    }

    private async decodeMarzbanLink(
        token: string,
        marzbanSecretKey: string,
    ): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (token.split('.').length === 3) {
            try {
                const payload = await this.jwtService.verifyAsync(token, {
                    secret: marzbanSecretKey,
                    algorithms: ['HS256'],
                });

                if (payload.access !== 'subscription') {
                    throw new Error('JWT access field is not subscription');
                }

                const jwtCreatedAt = new Date(payload.iat * 1000);

                if (!this.checkSubscriptionValidity(jwtCreatedAt, payload.sub)) {
                    return null;
                }

                this.logger.debug(`JWT verified successfully, ${JSON.stringify(payload)}`);

                return {
                    username: payload.sub,
                    createdAt: jwtCreatedAt,
                };
            } catch (err) {
                this.logger.debug(`JWT verification failed: ${err}`);
            }
        }

        const uToken = token.slice(0, token.length - 10);
        const uSignature = token.slice(token.length - 10);

        this.logger.debug(`Token parts: base: ${uToken}, signature: ${uSignature}`);

        let decoded: string;
        try {
            decoded = Buffer.from(uToken, 'base64url').toString();
        } catch (err) {
            this.logger.debug(`Base64 decode error: ${err}`);
            return null;
        }

        const hash = createHash('sha256');
        hash.update(uToken + marzbanSecretKey);
        const digest = hash.digest();

        const expectedSignature = Buffer.from(digest).toString('base64url').slice(0, 10);

        this.logger.debug(`Expected signature: ${expectedSignature}, actual: ${uSignature}`);

        if (uSignature !== expectedSignature) {
            this.logger.debug('Signature mismatch');
            return null;
        }

        const parts = decoded.split(',');
        if (parts.length < 2) {
            this.logger.debug(`Invalid token format: ${decoded}`);
            return null;
        }

        const username = parts[0];
        const createdAtInt = parseInt(parts[1], 10);

        if (isNaN(createdAtInt)) {
            this.logger.debug(`Invalid created_at timestamp: ${parts[1]}`);
            return null;
        }

        const createdAt = new Date(createdAtInt * 1000);

        if (!this.checkSubscriptionValidity(createdAt, username)) {
            return null;
        }

        this.logger.debug(`Token decoded. Username: ${username}, createdAt: ${createdAt}`);

        return {
            username,
            createdAt,
        };
    }

    private checkSubscriptionValidity(createdAt: Date, username: string): boolean {
        const validFrom = this.configService.get<string | undefined>(
            'MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM',
        );

        if (!validFrom) {
            return true;
        }

        const validFromDate = new Date(validFrom);
        if (createdAt < validFromDate) {
            this.logger.debug(
                `createdAt JWT: ${createdAt.toISOString()} is before validFrom: ${validFromDate.toISOString()}`,
            );

            this.logger.warn(
                `${JSON.stringify({ username, createdAt })} – subscription createdAt is before validFrom`,
            );

            return false;
        }

        return true;
    }
}
