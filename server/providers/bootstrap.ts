import { getProvider, registerProvider } from './registry';
import { createEzvidApiAdapter, createNhdApiAdapter, createStreamProviderAdapter } from './adapters/tmdb-hls';
import { createFaselHdAdapter } from './adapters/mapped-json';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [
    createEzvidApiAdapter(),
    createNhdApiAdapter(),
    createStreamProviderAdapter(),
    createFaselHdAdapter(),
  ]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
