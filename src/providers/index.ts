import type { Provider } from '@prisma/client';
import type { DeploymentProvider } from './types';
import { ProviderError } from './types';
import { VercelProvider } from './vercel';

export class ProviderRegistry {
  private readonly providers = new Map<Provider, DeploymentProvider>();

  register(provider: DeploymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(provider: Provider): DeploymentProvider {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new ProviderError(`No DeploymentProvider registered for ${provider}`);
    }
    return adapter;
  }

  has(provider: Provider): boolean {
    return this.providers.has(provider);
  }
}

export const providerRegistry = new ProviderRegistry();
providerRegistry.register(new VercelProvider());

export * from './types';
