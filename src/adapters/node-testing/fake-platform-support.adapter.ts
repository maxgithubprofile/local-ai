import type { PlatformSupportPort } from '../../core/ports/platform-support.port.js';

/**
 * In-memory fake used to drive `SupportChecker` unit tests across scenarios
 * (web without a plugin, native without a plugin, native with everything)
 * without any real platform — TZ §13.1. Constructed with a fixed fixture;
 * nothing here is I/O or async under the hood, it just reports back what it
 * was given.
 */
export class FakePlatformSupportAdapter implements PlatformSupportPort {
  constructor(
    private readonly fixture: {
      platform: 'ios' | 'android' | 'web' | string;
      isNative: boolean;
      availablePlugins: string[];
    },
  ) {}

  isNativePlatform(): boolean {
    return this.fixture.isNative;
  }

  getPlatform(): 'ios' | 'android' | 'web' | string {
    return this.fixture.platform;
  }

  isPluginAvailable(pluginName: string): boolean {
    return this.fixture.availablePlugins.includes(pluginName);
  }
}
