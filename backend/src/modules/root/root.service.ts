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
    private readonly mergeBase64: boolean;
    private readonly mergeXrayHosts: boolean;
    private readonly mergeXrayOutbounds: boolean;
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
        this.mergeBase64 = this.configService.getOrThrow<boolean>('MERGE_BASE64');
        this.mergeXrayHosts = this.configService.getOrThrow<boolean>('MERGE_XRAY_HOSTS');
        this.mergeXrayOutbounds = this.configService.getOrThrow<boolean>('MERGE_XRAY_OUTBOUNDS');
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
    private readonly FILTERED_OUTBOUND_PROTOCOLS = new Set(['blackhole', 'freedom', 'loopback']);

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

            mainLines.push(...lines);
        }

        return Buffer.from(mainLines.join('\n'), 'utf-8').toString('base64');
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
     * Collects `proxies` entries from all linked YAML subscriptions,
     * injects them into the main Clash config's proxies array,
     * and appends their names to every proxy-group that contains real proxies.
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

            for (const proxy of linkedDoc.proxies) {
                (mainDoc.proxies as unknown[]).push(proxy);

                const name = (proxy as Record<string, unknown>)?.name;
                if (typeof name === 'string') newProxyNames.push(name);
            }
        }

        if (newProxyNames.length > 0) {
            this.injectNamesIntoProxyGroups(mainDoc, newProxyNames);
        }

        return yaml.dump(mainDoc, { lineWidth: -1 });
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
                (group.proxies as string[]).push(...names);
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

    /** Merges full host configs from linked subscriptions into the current array (MERGE_HOSTS=true). */
    private async mergeByHosts(
        clientIp: string,
        linkedSubs: unknown[],
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType: TRequestTemplateTypeKeys | undefined,
        current: unknown[],
    ): Promise<unknown[]> {
        const merged = [...current];

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
            if (linkedArray) merged.push(...linkedArray);
        }

        return merged;
    }

    /** Injects outbounds from linked subscriptions into each config of the current array (MERGE_OUTBOUNDS=true). */
    private async mergeByOutbounds(
        clientIp: string,
        linkedSubs: unknown[],
        headers: NodeJS.Dict<string | string[]>,
        withClientType: boolean,
        clientType: TRequestTemplateTypeKeys | undefined,
        current: unknown[],
    ): Promise<unknown[]> {
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

                const filtered = outbounds.filter(
                    (ob: unknown) =>
                        !this.FILTERED_OUTBOUND_PROTOCOLS.has(
                            (ob as Record<string, unknown>)?.protocol as string,
                        ),
                );
                extraOutbounds.push(...filtered);
            }
        }

        if (extraOutbounds.length > 0) {
            for (const config of current) {
                const outbounds = (config as Record<string, unknown>).outbounds;
                if (Array.isArray(outbounds)) outbounds.push(...extraOutbounds);
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
