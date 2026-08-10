import type { PlatformSupportPort } from '../../core/ports/platform-support.port.js';

/**
 * Not implemented — Phase 1 (ROADMAP.md). In-memory fake used to drive
 * `SupportChecker` unit tests across scenarios (web without a plugin,
 * native without a plugin, native with everything) without any real
 * platform — TZ §13.1. Constructor should accept a fixed
 * `{ platform, isNative, availablePlugins }` fixture once implemented.
 */
export class FakePlatformSupportAdapter implements PlatformSupportPort {
  isNativePlatform(): boolean {
    throw new Error('not implemented — see TZ §6.1, §13.1, ROADMAP Phase 1');
  }

  getPlatform(): 'ios' | 'android' | 'web' | string {
    throw new Error('not implemented — see TZ §6.1, §13.1, ROADMAP Phase 1');
  }

  isPluginAvailable(_pluginName: string): boolean {
    throw new Error('not implemented — see TZ §6.1, §13.1, ROADMAP Phase 1');
  }
}
