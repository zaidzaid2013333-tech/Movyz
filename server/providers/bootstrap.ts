import { getProvider } from './registry';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;
  void getProvider;
}
