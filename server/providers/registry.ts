import type { ProviderAdapter } from './types';

const adapters = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter) {
  adapters.set(adapter.key, adapter);
}

export function getProvider(key: string) {
  return adapters.get(key);
}

export function getProviders() {
  return [...adapters.values()];
}

export async function healthCheckProviders() {
  return Promise.all(
    [...adapters.values()].map(async (adapter) => {
      const started = Date.now();
      try {
        const health = await adapter.health();
        return { ...health, key: adapter.key, name: adapter.name, latencyMs: Date.now() - started };
      } catch (error) {
        return {
          key: adapter.key,
          name: adapter.name,
          status: 'offline' as const,
          latencyMs: Date.now() - started,
          message: error instanceof Error ? error.message : 'Provider health check failed',
        };
      }
    }),
  );
}
