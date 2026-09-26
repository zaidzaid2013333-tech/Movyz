import { getProvider, registerProvider } from './registry';
import { createFaselHdAdapter } from './adapters/mapped-json';
import { createEzvidApiAdapter } from './adapters/ezvidapi';
import { createVidZeeAdapter } from './adapters/vidzee';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  for (const adapter of [createVidZeeAdapter(), createEzvidApiAdapter(), createFaselHdAdapter()]) {
    if (adapter && !getProvider(adapter.key)) registerProvider(adapter);
  }
}
