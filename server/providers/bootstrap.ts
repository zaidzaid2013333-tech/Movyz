import { getProvider, registerProvider } from './registry';
import { createFaselHdAdapter } from './adapters/mapped-json';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [createFaselHdAdapter()]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
