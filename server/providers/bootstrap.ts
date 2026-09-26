import { getProvider, registerProvider } from './registry';
import { createEzvidApiAdapter, createStreamProviderAdapter, createStreamFlixAdapter, createVidZeeAdapter } from './adapters/tmdb-hls';
import { createFaselHdAdapter } from './adapters/mapped-json';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [
    createVidZeeAdapter(),
    createFaselHdAdapter(),
    createStreamFlixAdapter(),
    createEzvidApiAdapter(),
    createStreamProviderAdapter(),
  ]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
