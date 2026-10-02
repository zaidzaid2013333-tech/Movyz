import { registerProvider, getProvider } from './registry';
import { createRe3ArabiAdapter } from './re3arabi';
import { createDoodStreamAdapter } from './dood';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;
  registerProvider(createDoodStreamAdapter());
  registerProvider(createRe3ArabiAdapter());
  void getProvider;
}
