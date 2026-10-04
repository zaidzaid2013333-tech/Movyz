import { load } from 'cheerio';
import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source,
    SourceType
} from '@omss/framework';

type Candidate = {
    url: string;
    title: string;
    year?: number;
};

type MediaResult = {
    url: string;
    type: SourceType;
    quality?: string;
};

export class AkwamProvider extends BaseProvider {
    readonly id = 'akwam';
    readonly name = 'Akwam';
    readonly enabled = true;

    readonly BASE_URL =
        process.env.AKWAM_BASE_URL?.replace(/\/$/, '') ?? 'https://akwam.ss';

    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.9',
        Referer: this.BASE_URL
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.resolve(media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.resolve(media);
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(this.BASE_URL, {
                method: 'HEAD',
                headers: this.HEADERS,
                signal: AbortSignal.timeout(10000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    private async resolve(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            const candidate = await this.findCandidate(media);

            if (!candidate) {
                return this.emptyResult(
                    'No matching Akwam title was found',
                    'AKWAM_NOT_FOUND'
                );
            }

            const detailHtml = await this.fetchText(candidate.url);
            if (!detailHtml) {
                return this.emptyResult(
                    'Failed to fetch detail page ' + candidate.url,
                    'AKWAM_DETAIL_FETCH_FAILED'
                );
            }

            const targets =
                media.type === 'movie'
                    ? this.extractTargets(detailHtml, candidate.url)
                    : await this.findEpisodeTargets(
                          media,
                          detailHtml,
                          candidate.url
                      );

            if (!targets.length) {
                return this.emptyResult(
                    'No watch/download target was exposed by Akwam',
                    'AKWAM_NO_TARGET'
                );
            }

            const results = await Promise.allSettled(
                targets.slice(0, 12).map((target) => this.resolveTarget(target))
            );

            const mediaResults = results
                .filter(
                    (result): result is PromiseFulfilledResult<MediaResult | null> =>
                        result.status === 'fulfilled' && Boolean(result.value)
                )
                .map((result) => result.value)
                .filter((value): value is MediaResult => Boolean(value));

            const uniqueResults = Array.from(
                new Map(mediaResults.map((result) => [result.url, result])).values()
            );

            // A resolved URL is not necessarily playable. Some Akwam mirrors can
            // return a URL that stalls or fails only when the browser starts a
            // range request. Validate a small byte range before exposing it.
            const validatedResults = await this.validateMediaResults(uniqueResults);

            const sourceMap = new Map<string, Source>();
            for (const result of validatedResults) {
                const source = this.toSource(result);
                if (source && !sourceMap.has(source.url)) {
                    sourceMap.set(source.url, source);
                }
            }

            const sources = Array.from(sourceMap.values());

            if (!sources.length) {
                return this.emptyResult(
                    uniqueResults.length
                        ? 'Akwam exposed media URLs, but none passed the playback health check'
                        : 'Akwam targets did not expose a supported media URL',
                    uniqueResults.length
                        ? 'AKWAM_MEDIA_UNREACHABLE'
                        : 'AKWAM_NO_MEDIA'
                );
            }

            return {
                sources,
                subtitles: [],
                diagnostics: []
            };
        } catch (error) {
            return this.emptyResult(
                error instanceof Error ? error.message : 'Unknown provider error',
                'AKWAM_PROVIDER_ERROR'
            );
        }
    }

    private async validateMediaResults(results: MediaResult[]): Promise<MediaResult[]> {
        const checks = await Promise.all(
            results.slice(0, 8).map(async (result) => {
                const startedAt = Date.now();

                try {
                    const response = await fetch(result.url, {
                        method: 'GET',
                        headers: {
                            ...this.HEADERS,
                            Accept:
                                result.type === 'hls'
                                    ? 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8'
                                    : 'video/mp4,video/webm,application/octet-stream,*/*;q=0.8',
                            Range: 'bytes=0-524287'
                        },
                        redirect: 'follow',
                        signal: AbortSignal.timeout(8000)
                    });

                    if (!response.ok && response.status !== 206) return null;

                    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
                    const contentLength = Number(response.headers.get('content-length') ?? 0);
                    const reader = response.body?.getReader();
                    const chunks: Uint8Array[] = [];
                    let totalBytes = 0;

                    if (reader) {
                        try {
                            for (let i = 0; i < 16 && totalBytes < 524288; i += 1) {
                                const part = await reader.read();
                                if (part.done) break;
                                if (part.value?.length) {
                                    chunks.push(part.value);
                                    totalBytes += part.value.length;
                                }
                            }
                        } finally {
                            void reader.cancel().catch(() => undefined);
                        }
                    }

                    if (!totalBytes) return null;

                    const bytes = new Uint8Array(totalBytes);
                    let offset = 0;
                    for (const chunk of chunks) {
                        bytes.set(chunk, offset);
                        offset += chunk.length;
                    }

                    if (result.type === 'hls') {
                        const text = new TextDecoder().decode(bytes);
                        if (!/#EXTM3U/i.test(text)) return null;
                    } else {
                        const looksLikeMedia =
                            contentType.startsWith('video/') ||
                            contentType.includes('octet-stream') ||
                            this.hasMp4Signature(bytes);
                        if (!looksLikeMedia) return null;
                    }

                    return {
                        result,
                        latencyMs: Math.max(1, Date.now() - startedAt),
                        contentLength
                    };
                } catch {
                    return null;
                }
            })
        );

        // Keep the fastest healthy mirror first. The UI exposes all validated
        // qualities/sources separately for manual selection.
        return checks
            .filter(
                (
                    value
                ): value is {
                    result: MediaResult;
                    latencyMs: number;
                    contentLength: number;
                } => Boolean(value)
            )
            .sort((a, b) => {
                return a.latencyMs - b.latencyMs;
            })
            .map((item) => item.result);
    }

    private hasMp4Signature(bytes: Uint8Array): boolean {
        const limit = Math.min(bytes.length - 4, 256);
        for (let index = 0; index <= limit; index += 1) {
            if (
                bytes[index] === 0x66 &&
                bytes[index + 1] === 0x74 &&
                bytes[index + 2] === 0x79 &&
                bytes[index + 3] === 0x70
            ) {
                return true;
            }
        }
        return false;
    }

    private async findCandidate(
        media: ProviderMediaObject
    ): Promise<Candidate | null> {
        const queries = [
            media.title,
            this.readOptionalString(media, 'originalTitle'),
            this.readOptionalString(media, 'arabicTitle')
        ]
            .map((value) => value?.trim())
            .filter((value): value is string => Boolean(value))
            .filter((value, index, all) => all.indexOf(value) === index);

        for (const query of queries) {
            const searchHtml = await this.fetchText(
                this.BASE_URL + '/search?q=' + encodeURIComponent(query)
            );
            if (!searchHtml) continue;

            const candidates = this.parseSearchResults(searchHtml);
            const ranked = candidates
                .map((item) => ({
                    item,
                    score: this.scoreCandidate(item, media)
                }))
                .sort((a, b) => b.score - a.score);

            if (ranked[0] && ranked[0].score >= 55) {
                return ranked[0].item;
            }
        }

        return null;
    }

    private parseSearchResults(html: string): Candidate[] {
        const $ = load(html);
        const results: Candidate[] = [];

        $('a[href]').each((_, element) => {
            const href = $(element).attr('href');
            if (!href) return;

            const absoluteUrl = new URL(href, this.BASE_URL).href;
            if (
                !new URL(absoluteUrl).hostname.endsWith(
                    new URL(this.BASE_URL).hostname
                )
            ) {
                return;
            }

            if (
                !/\/(?:movie|series|show|anime)\//i.test(
                    new URL(absoluteUrl).pathname
                )
            ) {
                return;
            }

            const title =
                $(element).find('.entry-title, .text-white').first().text().trim() ||
                $(element).find('img[alt]').first().attr('alt')?.trim() ||
                $(element).text().replace(/\s+/g, ' ').trim();

            if (!title || title.length < 2) return;

            const yearText =
                $(element).find('.badge-secondary').first().text().trim() ||
                $(element).text().match(/\b(?:19|20)\d{2}\b/)?.[0];

            const year = yearText
                ? Number(yearText.match(/\b(?:19|20)\d{2}\b/)?.[0])
                : undefined;

            if (!results.some((item) => item.url === absoluteUrl)) {
                results.push({
                    url: absoluteUrl,
                    title,
                    year
                });
            }
        });

        return results;
    }

    private scoreCandidate(
        candidate: Candidate,
        media: ProviderMediaObject
    ): number {
        const candidateTitle = this.normalize(candidate.title);
        const titles = [
            media.title,
            this.readOptionalString(media, 'originalTitle'),
            this.readOptionalString(media, 'arabicTitle')
        ]
            .filter((value): value is string => Boolean(value))
            .map((value) => this.normalize(value));

        let score = 0;

        for (const title of titles) {
            if (candidateTitle === title) {
                score = Math.max(score, 100);
                continue;
            }

            if (candidateTitle.includes(title) || title.includes(candidateTitle)) {
                score = Math.max(score, 84);
                continue;
            }

            const overlap = this.tokenOverlap(candidateTitle, title);
            score = Math.max(score, 40 + overlap * 40);
        }

        const mediaYear = this.readOptionalNumber(media, 'year');
        if (mediaYear && candidate.year) {
            if (mediaYear === candidate.year) score += 15;
            else if (Math.abs(mediaYear - candidate.year) === 1) score += 5;
            else score -= 20;
        }

        return Math.min(120, score);
    }

    private extractTargets(html: string, baseUrl: string): string[] {
        const $ = load(html);
        const targets = new Set<string>();

        $('a[href], [data-href], [data-url]').each((_, element) => {
            const href =
                $(element).attr('href') ??
                $(element).attr('data-href') ??
                $(element).attr('data-url');

            if (!href || href.startsWith('javascript:') || href === '#') return;

            const text = $(element).text().replace(/\s+/g, ' ').trim();
            const absoluteUrl = new URL(href, baseUrl).href;

            if (
                /مشاهدة|watch|تحميل|download|رابط|quality|1080|720|480/i.test(text) ||
                /\/(?:watch|download|link)\//i.test(new URL(absoluteUrl).pathname)
            ) {
                targets.add(absoluteUrl);
            }
        });

        $('iframe[src], video[src], source[src]').each((_, element) => {
            const src = $(element).attr('src');
            if (!src) return;
            targets.add(new URL(src, baseUrl).href);
        });

        for (const url of this.extractMediaLikeUrls($.html())) {
            targets.add(url);
        }

        return Array.from(targets);
    }

    private async findEpisodeTargets(
        media: ProviderMediaObject,
        seriesHtml: string,
        seriesUrl: string
    ): Promise<string[]> {
        const season = this.readOptionalNumber(media, 's') ?? 1;
        const episode = this.readOptionalNumber(media, 'e') ?? 1;
        const $ = load(seriesHtml);
        const exact: Array<{ url: string; score: number }> = [];

        $('a[href], [data-href], [data-url]').each((_, element) => {
            const href =
                $(element).attr('href') ??
                $(element).attr('data-href') ??
                $(element).attr('data-url');

            if (!href || href.startsWith('javascript:') || href === '#') return;

            const url = new URL(href, seriesUrl).href;
            const label = [
                $(element).text(),
                url,
                $(element).attr('title') ?? ''
            ]
                .join(' ')
                .replace(/\s+/g, ' ');

            let score = 0;

            if (new RegExp('(?:^|\D)' + episode + '(?:\D|$)', 'i').test(label)) {
                score += 70;
            }

            if (
                new RegExp(
                    '(?:season|الموسم)\D{0,6}' +
                        season +
                        '(?:\D|$)|s0*' +
                        season,
                    'i'
                ).test(label)
            ) {
                score += 25;
            }

            if (/\/(?:episode|watch|show\/episode)\//i.test(new URL(url).pathname)) {
                score += 20;
            }

            if (score >= 70) {
                exact.push({ url, score });
            }
        });

        exact.sort((a, b) => b.score - a.score);

        const unique: string[] = [];
        for (const item of exact) {
            if (!unique.includes(item.url)) unique.push(item.url);
            if (unique.length >= 8) break;
        }

        if (unique.length) return unique;

        return this.extractTargets(seriesHtml, seriesUrl).slice(0, 8);
    }

    private async resolveTarget(targetUrl: string): Promise<MediaResult | null> {
        const direct = this.extractMediaUrl(targetUrl);
        if (direct) return direct;

        if (!/^https?:\/\//i.test(targetUrl)) return null;

        const html = await this.fetchText(targetUrl);
        if (!html) return null;

        const media = this.extractMediaUrl(html, targetUrl);
        if (media) return media;

        const $ = load(html);
        const nestedLinks = new Set<string>();

        $('a[href], [data-href], [data-url], iframe[src], video[src], source[src]').each(
            (_, element) => {
                const href =
                    $(element).attr('href') ??
                    $(element).attr('data-href') ??
                    $(element).attr('data-url') ??
                    $(element).attr('src');

                if (!href || href.startsWith('javascript:') || href === '#') return;

                const absolute = new URL(href, targetUrl).href;
                if (
                    /\/(?:download|watch|link)\//i.test(new URL(absolute).pathname) ||
                    /(?:m3u8|mp4)(?:\?|$)/i.test(absolute)
                ) {
                    nestedLinks.add(absolute);
                }
            }
        );

        for (const link of Array.from(nestedLinks).slice(0, 8)) {
            const nestedDirect = this.extractMediaUrl(link);
            if (nestedDirect) return nestedDirect;

            const nestedHtml = await this.fetchText(link);
            if (!nestedHtml) continue;

            const nestedMedia = this.extractMediaUrl(nestedHtml, link);
            if (nestedMedia) return nestedMedia;
        }

        return null;
    }

    private extractMediaUrl(
        input: string,
        baseUrl = this.BASE_URL
    ): MediaResult | null {
        const direct = input.match(
            /https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi
        );

        if (direct?.length) {
            const url = direct[0];
            return {
                url,
                type: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'mp4',
                quality: this.inferAkwamQuality(input)
            };
        }

        const $ = load(input);
        const embedded =
            $('iframe[src], video[src], source[src]').first().attr('src') ||
            $('iframe[data-src], video[data-src], source[data-src]')
                .first()
                .attr('data-src');

        if (embedded) {
            const url = new URL(embedded, baseUrl).href;
            if (/\.(?:m3u8|mp4)(?:\?|$)/i.test(url)) {
                return {
                    url,
                    type: /\.m3u8/i.test(url) ? 'hls' : 'mp4',
                    quality: this.inferAkwamQuality(input)
                };
            }
        }

        const bodyText = $.root().text();
        const fileMatch = bodyText.match(
            /(?:file|source|src|videoUrl|video_url|stream|streamUrl)\s*[:=]\s*["']([^"']+)["']/i
        );

        if (fileMatch?.[1]) {
            const url = new URL(fileMatch[1], baseUrl).href;
            if (/\.(?:m3u8|mp4)(?:\?|$)/i.test(url)) {
                return {
                    url,
                    type: /\.m3u8/i.test(url) ? 'hls' : 'mp4',
                    quality: this.inferAkwamQuality(bodyText)
                };
            }
        }

        return null;
    }

    private extractMediaLikeUrls(html: string): string[] {
        const urls =
            html.match(
                /https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi
            ) ?? [];

        return Array.from(new Set(urls));
    }

    private fetchText(url: string): Promise<string | null> {
        return fetch(url, {
            headers: this.HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        }).then(async (response) => {
            if (!response.ok) return null;
            return response.text();
        });
    }

    private toSource(result: MediaResult): Source | null {
        if (!/^https?:\/\//i.test(result.url)) return null;

        return {
            url: this.createProxyUrl(result.url, {
                ...this.HEADERS,
                Referer: this.BASE_URL
            }),
            type: result.type,
            quality: result.quality ?? 'Auto',
            audioTracks: [
                {
                    language: 'und',
                    label: 'Original'
                }
            ],
            provider: {
                id: this.id,
                name: this.name
            }
        };
    }

    private inferAkwamQuality(text: string): string | undefined {
        const match = text.match(
            /(?:^|\D)(2160|1440|1080|720|576|480|360)(?:p)?(?:\D|$)/i
        );
        return match?.[1];
    }

    private normalize(value: string): string {
        return value
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[إأآٱ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ؤ/g, 'و')
            .replace(/ئ/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private tokenOverlap(left: string, right: string): number {
        const a = new Set(left.split(' ').filter(Boolean));
        const b = new Set(right.split(' ').filter(Boolean));
        if (!a.size || !b.size) return 0;

        let common = 0;
        for (const token of a) {
            if (b.has(token)) common++;
        }

        return common / Math.max(a.size, b.size);
    }

    private readOptionalString(
        media: ProviderMediaObject,
        key: 'originalTitle' | 'arabicTitle'
    ): string | undefined {
        const value = (media as ProviderMediaObject & Record<string, unknown>)[key];
        return typeof value === 'string' ? value : undefined;
    }

    private readOptionalNumber(
        media: ProviderMediaObject,
        key: 'year' | 's' | 'e'
    ): number | undefined {
        const value = (media as ProviderMediaObject & Record<string, unknown>)[key];
        return typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim()
              ? Number(value)
              : undefined;
    }

    private emptyResult(message: string, code: string): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code: 'PROVIDER_ERROR',
                    message: this.name + ': ' + message,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }
}
