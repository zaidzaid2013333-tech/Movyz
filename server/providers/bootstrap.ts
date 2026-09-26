import { getProvider, registerProvider } from './registry';
import { createEzvidApiAdapter, createStreamProviderAdapter, createStreamFlixAdapter } from './adapters/tmdb-hls';
import { createMovieBoxApiAdapter } from './adapters/moviebox';
import { createFaselHdAdapter } from './adapters/mapped-json';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [
    createMovieBoxApiAdapter(),
    createFaselHdAdapter(),
    createStreamFlixAdapter(),
    createEzvidApiAdapter(),
    createStreamProviderAdapter(),
  ]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
