import { registerProvider, getProvider } from './registry';
import { createRe3ArabiAdapter } from './re3arabi';
import { createDoodStreamAdapter } from './dood';
import { createArProvAdapter } from './arprov';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;
  registerProvider(createDoodStreamAdapter());
  registerProvider(createArProvAdapter());
  registerProvider(createRe3ArabiAdapter());
  void getProvider;
}
