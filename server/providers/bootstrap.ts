import { registerProvider, getProvider } from './registry';
import { createRe3ArabiAdapter } from './re3arabi';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;
  registerProvider(createRe3ArabiAdapter());
  void getProvider;
}
