import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source,
    SourceType
} from '@omss/framework';

type AkwamCandidate = {
    url: string;
    title: string;
    year?: number;
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
        return this.getSources(media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
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

    private async getSources(
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
                    `Failed to fetch Akwam detail page: ${candidate.url}`,
                    'AKWAM_DETAIL_FETCH_FAILED'
                );
            }

            const targetUrls =
                media.type === 'movie'
                    ? this.extractMovieTargets(detailHtml, candidate.url)
                    : await this.resolveEpisodeTargets(
                          media,
                          detailHtml,
                          candidate.url
                      );

            if (!targetUrls.length) {
                return this.emptyResult(
                    'Akwam page contained no playable target links',
                    'AKWAM_NO_TARGET'
                );
            }

            const sources = await this.resolveSources(targetUrls);

            if (!sources.length) {
                return this.emptyResult(
                    'Akwam target links did not expose a supported direct media URL',
                    'AKWAM_NO_MEDIA'
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

    private async findCandidate(
        media: ProviderMediaObject
    ): Promise<AkwamCandidate | null> {
        const queries = [
            media.title,
            this.getOriginalTitle(media),
            this.getArabicTitle(media)
        ]
            .map((value) => value?.trim())
            .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);

        for (const query of queries) {
            const html = await this.fetchText(
                `${this.BASE_URL}/search?q=${encodeURIComponent(query!)}`
            );
            if (!html) continue;

            const candidates = this.extractCandidates(html);
            const scored = candidates
                .map((candidate) => ({
                    candidate,
                    score: this.scoreCandidate(candidate, media)
                }))
                .sort((a, b) => b.score - a.score);

            const best = scored[0];
            if (best && best.score >= 55) {
                return best.candidate;
            }
        }

        return null;
    }

    private extractCandidates(html: string): AkwamCandidate[] {
        const anchors = html.match(/<a\\b[^>]*href=["'][^"']+["'][^>]*>[\\s\\S]*?<\\/a>/gi) ?? [];
        const results: AkwamCandidate[] = [];

        for (const anchor of anchors) {
            const hrefMatch = anchor.match(/href=["']([^"']+)["']/i);
            if (!hrefMatch) continue;

            const href = hrefMatch[1];
            if (!/\\/(?:movie|series|show|anime)\\//i.test(href)) continue;

            const title =
                this.cleanText(
                    this.firstMatch(anchor, [
                        /alt=["']([^"']+)["']/i,
                        /class=["'][^"']*entry-title[^"']*["'][^>]*>([\\s\\S]*?)<\\//i,
                        />\\s*([^<>]{2,120})\\s*<\\/a>/i
                    ]) ?? ''
                );

            if (!title) continue;

            const yearText =
                this.firstMatch(anchor, [
                    /badge-secondary[^>]*>\\s*(20\\d{2}|19\\d{2})\\s*</i,
                    /(?:^|\\D)(20\\d{2}|19\\d{2})(?:\\D|$)/
                ]) ?? undefined;

            const url = new URL(href, this.BASE_URL).href;
            if (results.some((item) => item.url === url)) continue;

            results.push({
                url,
                title,
                year: yearText ? Number(yearText) : undefined
            });
        }

        return results;
    }

    private scoreCandidate(
        candidate: AkwamCandidate,
        media: ProviderMediaObject
    ): number {
        const left = this.normalize(candidate.title);
        const titles = [
            media.title,
            this.getOriginalTitle(media),
            this.getArabicTitle(media)
        ]
            .filter(Boolean)
            .map((value) => this.normalize(value!));

        let score = 0;

        for (const title of titles) {
            if (!title) continue;
            if (left === title) score = Math.max(score, 100);
            else if (left.includes(title) || title.includes(left)) {
                score = Math.max(score, 82);
            } else {
                const overlap = this.tokenOverlap(left, title);
                score = Math.max(score, 40 + overlap * 40);
            }
        }

        const year = this.getMediaYear(media);
        if (year && candidate.year) {
            if (year === candidate.year) score += 15;
            else if (Math.abs(year - candidate.year) <= 1) score += 5;
            else score -= 20;
        }

        return Math.min(score, 120);
    }

    private async resolveEpisodeTargets(
        media: ProviderMediaObject,
        seriesHtml: string,
        seriesUrl: string
    ): Promise<string[]> {
        const season = Number(media.s ?? 1);
        const episode = Number(media.e ?? 1);

        const links = this.extractEpisodeLinks(seriesHtml, season, episode);

        if (links.length) {
            return links;
        }

        // Some Akwam pages expose season/episode links only after navigating
        // through an intermediate episode index. Keep this fallback conservative:
        // follow only ordinary same-site links that explicitly mention the target episode.
        const candidates = this.extractAllLinks(seriesHtml, seriesUrl).filter(
            (url) =>
                new RegExp(
                    `(?:season[-_ /]?${season}[^\\d]*episode[-_ /]?${episode}|s0*${season}e0*${episode})`,
                    'i'
                ).test(url)
        );

        return candidates.slice(0, 4);
    }

    private extractEpisodeLinks(
        html: string,
        season: number,
        episode: number
    ): string[] {
        const anchors = html.match(/<a\\b[^>]*href=["'][^"']+["'][^>]*>[\\s\\S]*?<\\/a>/gi) ?? [];
        const results: string[] = [];

        for (const anchor of anchors) {
            const hrefMatch = anchor.match(/href=["']([^"']+)["']/i);
            if (!hrefMatch) continue;

            const text = this.cleanText(anchor.replace(/<[^>]+>/g, ' '));
            const href = new URL(hrefMatch[1], this.BASE_URL).href;

            const explicitEpisode =
                new RegExp(
                    `(?:^|\\D)(?:${episode})(?:\\D|$)`,
                    'i'
                ).test(text) || /\\/episode(?:s)?\\//i.test(href);

            if (!explicitEpisode) continue;

            const seasonMatch =
                new RegExp(
                    `(?:season|الموسم)\\D{0,4}${season}(?:\\D|$)|s0*${season}`,
                    'i'
                ).test(text + ' ' + href);

            if (seasonMatch || !/season|الموسم|s\\d/i.test(text + ' ' + href)) {
                if (!results.includes(href)) results.push(href);
            }
        }

        return results.slice(0, 6);
    }

    private extractMovieTargets(html: string, pageUrl: string): string[] {
        const targets = this.extractAllLinks(html, pageUrl).filter((url) =>
            /\\/(?:watch|download|link)\\//i.test(url)
        );

        const mediaLinks = this.extractMediaLikeUrls(html);
        return Array.from(new Set([...targets, ...mediaLinks])).slice(0, 12);
    }

    private async resolveSources(targetUrls: string[]): Promise<Source[]> {
        const results = await Promise.allSettled(
            targetUrls.map(async (targetUrl) => {
                const direct = this.extractMediaUrl(targetUrl);
                if (direct) return direct;

                if (!this.isHttpUrl(targetUrl)) return null;

                const html = await this.fetchText(targetUrl);
                if (!html) return null;

                return this.extractMediaUrl(html, targetUrl);
            })
        );

        const unique = new Map<string, Source>();

        for (const result of results) {
            if (result.status !== 'fulfilled' || !result.value) continue;
            const source = this.toSource(result.value);
            if (source && !unique.has(source.url)) {
                unique.set(source.url, source);
            }
        }

        return Array.from(unique.values());
    }

    private extractMediaUrl(
        input: string,
        baseUrl = this.BASE_URL
    ): { url: string; type: SourceType; quality?: string } | null {
        const normalized = input.replace(/\\\\\\/g, '\\');

        const directMatch = normalized.match(
            /https?:\\/\\/[^\\s"'<>\\]+\\.(?:m3u8(?:\\?[^\\s"'<>]*)?|mp4(?:\\?[^\\s"'<>]*)?)(?:[^\\s"'<>]*)?/i
        );

        if (directMatch) {
            return {
                url: directMatch[0],
                type: /\\.m3u8(?:\\?|$)/i.test(directMatch[0]) ? 'hls' : 'mp4',
                quality: this.inferQuality(normalized)
            };
        }

        const iframeMatch = normalized.match(
            /<(?:iframe|video|source)[^>]+(?:src|data-src)=["']([^"']+)["']/i
        );

        if (iframeMatch) {
            const url = new URL(iframeMatch[1], baseUrl).href;
            if (/\\.(?:m3u8|mp4)(?:\\?|$)/i.test(url)) {
                return {
                    url,
                    type: /\\.m3u8/i.test(url) ? 'hls' : 'mp4',
                    quality: this.inferQuality(normalized)
                };
            }
        }

        const fileMatch = normalized.match(
            /(?:file|source|src|videoUrl|video_url|stream|streamUrl)\\s*[:=]\\s*["']([^"']+)["']/i
        );

        if (fileMatch && /^(?:https?:)?\\/\\//i.test(fileMatch[1])) {
            const url = new URL(fileMatch[1], baseUrl).href;
            if (/\\.(?:m3u8|mp4)(?:\\?|$)/i.test(url)) {
                return {
                    url,
                    type: /\\.m3u8/i.test(url) ? 'hls' : 'mp4',
                    quality: this.inferQuality(normalized)
                };
            }
        }

        return null;
    }

    private extractMediaLikeUrls(html: string): string[] {
        const urls = html.match(
            /https?:\\/\\/[^\\s"'<>]+\\.(?:m3u8|mp4)(?:\\?[^\\s"'<>]*)?/gi
        );

        return urls ? Array.from(new Set(urls)) : [];
    }

    private extractAllLinks(html: string, baseUrl: string): string[] {
        const matches =
            html.match(/<a\\b[^>]*href=["'][^"']+["'][^>]*>/gi) ?? [];

        return matches
            .map((tag) => tag.match(/href=["']([^"']+)["']/i)?.[1])
            .filter((href): href is string => Boolean(href))
            .map((href) => new URL(href, baseUrl).href)
            .filter((url) => url.startsWith('http'));
    }

    private async fetchText(url: string): Promise<string | null> {
        const response = await fetch(url, {
            headers: this.HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) return null;
        return response.text();
    }

    private toSource(
        result: { url: string; type: SourceType; quality?: string }
    ): Source | null {
        if (!/^https?:\\/\\//i.test(result.url)) return null;

        return {
            url: this.createProxyUrl(result.url, {
                ...this.HEADERS,
                Referer: this.BASE_URL
            }),
            type: result.type,
            quality: result.quality ?? 'Auto',
            audioTracks: [
                {
                    label: 'Original',
                    language: 'und'
                }
            ],
            provider: {
                id: this.id,
                name: this.name
            }
        };
    }

    private inferQuality(text: string): string | undefined {
        const match = text.match(/(?:^|\\D)(2160|1440|1080|720|576|480|360)(?:p)?(?:\\D|$)/i);
        return match?.[1];
    }

    private getMediaYear(media: ProviderMediaObject): number | undefined {
        const value = (media as ProviderMediaObject & { year?: number }).year;
        return typeof value === 'number' ? value : undefined;
    }

    private getOriginalTitle(
        media: ProviderMediaObject
    ): string | undefined {
        return (media as ProviderMediaObject & { originalTitle?: string })
            .originalTitle;
    }

    private getArabicTitle(
        media: ProviderMediaObject
    ): string | undefined {
        return (media as ProviderMediaObject & { arabicTitle?: string })
            .arabicTitle;
    }

    private normalize(value: string): string {
        return value
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[إأآٱ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ؤ/g, 'و')
            .replace(/ئ/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
            .replace(/\\s+/g, ' ')
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

    private firstMatch(input: string, patterns: RegExp[]): string | null {
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match?.[1]) return this.cleanText(match[1]);
        }
        return null;
    }

    private cleanText(value: string): string {
        return value
            .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
            .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/\\s+/g, ' ')
            .trim();
    }

    private isHttpUrl(value: string): boolean {
        return /^https?:\\/\\//i.test(value);
    }

    private emptyResult(message: string, code: string): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code,
                    message: `${this.name}: ${message}`,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }
}
