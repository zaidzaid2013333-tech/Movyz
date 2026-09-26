import { getProvider, registerProvider } from './registry';
import { createFaselHdAdapter } from './adapters/mapped-json';
import { createTmdbEmbedAdapter } from './adapters/tmdb-embed';
import { createStreamProviderAdapter } from './adapters/streamprovider';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [createStreamProviderAdapter(), createTmdbEmbedAdapter(), createFaselHdAdapter()]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
