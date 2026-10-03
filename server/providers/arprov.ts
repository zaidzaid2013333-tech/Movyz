import { resolveAkwamPlayback } from './arprov-akwam';
import { fetchArProvPage, type ArProvBrowserBinding } from './arprov-runtime';
import type { NormalizedPlaybackSource, ProviderContext } from './types';
import { fetchWithTimeout } from './http';

export type ArProvRuntimeOptions = {
  browserBinding?: ArProvBrowserBinding;
};

export async function resolveArProvPlayback(
  context: ProviderContext,
  runtime: ArProvRuntimeOptions = {},
): Promise<NormalizedPlaybackSource[]> {
  return resolveAkwamPlayback(context, runtime);
}

export function createArProvAdapter() {
  return {
    key: 'arprov',
    name: 'ArProv',
    enabled: true,
    requiresMapping: false,
    resolveMovie: (ctx: ProviderContext) => resolveArProvPlayback(ctx),
    resolveEpisode: (ctx: ProviderContext) => resolveArProvPlayback(ctx),
    async health() {
      const started = Date.now();
      const bases = ['https://akwam.ss/', 'https://ak.sv/', 'https://akwam.net/', 'https://akwam.it/'];

      for (const base of bases) {
        try {
          const response = await fetchWithTimeout(base, {
            method: 'GET',
            redirect: 'follow',
            timeoutMs: 4_500,
            headers: {
              Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
              'User-Agent': 'Movyza-ArProv/1.0',
            },
          });

          if (response.status >= 200 && response.status < 500) {
            return {
              status: response.ok ? 'healthy' as const : 'degraded' as const,
              latencyMs: Date.now() - started,
              message: `ArProv Akwam ${response.status} via ${new URL(base).hostname}`,
            };
          }
        } catch {
          // Try the next current Akwam domain.
        }
      }

      return {
        status: 'offline' as const,
        latencyMs: Date.now() - started,
        message: 'No Akwam endpoint responded',
      };
    },
  };
}

export async function diagnoseArProvPage(url: string, browserBinding?: ArProvBrowserBinding) {
  return fetchArProvPage(url, {
    browserBinding,
    timeoutMs: 10_000,
  });
}
