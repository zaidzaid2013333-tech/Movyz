import { getProvider, registerProvider } from './registry';
import { createFaselHdAdapter } from './adapters/mapped-json';
import { createEzvidApiAdapter } from './adapters/ezvidapi';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [createEzvidApiAdapter(), createFaselHdAdapter()]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
