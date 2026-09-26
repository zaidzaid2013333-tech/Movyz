import { getProvider, registerProvider } from './registry';
import { createMovieBoxApiAdapter } from './adapters/moviebox';
import { createFaselHdAdapter } from './adapters/mapped-json';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [
    createMovieBoxApiAdapter(),
    createFaselHdAdapter(),
  ]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
