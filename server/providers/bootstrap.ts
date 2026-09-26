import { getProvider, registerProvider } from './registry';
import { createFaselHdAdapter } from './adapters/faselhd';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;

  const adapter = createFaselHdAdapter();
  if (adapter && !getProvider(adapter.key)) {
    registerProvider(adapter);
  }
}
