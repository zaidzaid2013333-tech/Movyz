import { getProvider } from './registry';

let bootstrapped = false;

export function registerBuiltInProviders() {
  if (bootstrapped) return;
  bootstrapped = true;
  // Playback is owned by the dedicated AbdoBest → Akwam Watch API.
  // No legacy Fasel adapter is registered.
  void getProvider;
}
