import { z } from 'zod';
import type { NormalizedPlaybackSource, ProviderAdapter, ProviderContext } from './types';

const responseSchema = z.object({
  sources: z.array(z.object({
    url: z.string().url(),
    type: z.enum(['hls', 'mp4', 'dash']),
    quality: z.string().default('auto'),
    language: z.string().default('und'),
    label: z.string().default('External source'),
    providerReference: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
  })).default([]),
});

const baseUrl = (process.env.MOVYZA_EXTERNAL_PROVIDER_URL || '').replace(/\\/$/, '');
const token = process.env.MOVYZA_EXTERNAL_PROVIDER_TOKEN || '';

function headers() {
  return {
    accept: 'application/json',
    ...(token ? { authorization: 'Bearer ' + token } : {}),
  };
}

async function fetchJson(path: string, params?: Record<string, string | number>) {
  if (!baseUrl) throw new Error('MOVYZA_EXTERNAL_PROVIDER_URL is not configured');
  const url = new URL(baseUrl + path);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error('External provider request failed: ' + response.status);
  return response.json();
}

function resolveParams(context: ProviderContext, type: 'movie' | 'episode') {
  if (!context.tmdbId) throw new Error('TMDB id is required');
  const params: Record<string, string | number> = { type, tmdbId: context.tmdbId };
  if (type === 'episode') {
    if (!context.seasonNumber || !context.episodeNumber) throw new Error('Season and episode are required');
    params.season = context.seasonNumber;
    params.episode = context.episodeNumber;
  }
  return params;
}

async function resolve(type: 'movie' | 'episode', context: ProviderContext): Promise<NormalizedPlaybackSource[]> {
  if (!baseUrl) return [];
  const payload = await fetchJson('/resolve', resolveParams(context, type));
  return responseSchema.parse(payload).sources;
}

const externalProvider: ProviderAdapter = {
  key: 'external-api',
  name: 'External Playback API',
  enabled: Boolean(baseUrl),
  async resolveMovie(context) { return resolve('movie', context); },
  async resolveEpisode(context) { return resolve('episode', context); },
  async health() {
    const started = Date.now();
    if (!baseUrl) return { status: 'offline', latencyMs: 0, message: 'Provider URL is not configured' };
    try {
      await fetchJson('/health');
      return { status: 'healthy', latencyMs: Date.now() - started };
    } catch (error) {
      return { status: 'offline', latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'Health check failed' };
    }
  },
};

export default externalProvider;
