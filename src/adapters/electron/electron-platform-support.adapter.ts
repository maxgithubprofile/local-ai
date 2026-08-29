import type { App } from 'electron';
import type { PlatformSupportPort } from '../../core/ports/platform-support.port.js';

/** Minimal slice of `llama-cpp-pro/desktop`'s CJS API this adapter calls — real shape confirmed by reading `node_modules/llama-cpp-pro/desktop/resolve-package-root.cjs`/`desktop/src/main/index.cjs` directly (docs/adr/0011-electron-sidecar-build.md). */
interface LlamaCppProDesktop {
  getResourcesPathForApp(app: App): string;
  assertSidecarBinary(resourcesPath: string): string;
}

/**
 * Real `PlatformSupportPort` for Electron's main process (TZ v6 §6.1,
 * ELEC.1.2). Unlike Capacitor's adapter, there is no plugin registry to
 * query — `sql`/`download`/`fs` are always available (plain Node in the
 * main process, no native plugin gate); `inference` is the one capability
 * that can genuinely be unavailable, gated on whether
 * `llama-cpp-pro/desktop`'s `assertSidecarBinary()` actually finds a built
 * sidecar binary for this OS/arch/backend under the app's resources path
 * — currently `false` in every environment until `docs/adr/
 * 0011-electron-sidecar-build.md`'s build blocker is resolved upstream,
 * which is the **correct**, honest behavior, not a placeholder.
 */
export class ElectronPlatformSupportAdapter implements PlatformSupportPort {
  constructor(
    private readonly app: App,
    private readonly desktop: LlamaCppProDesktop,
  ) {}

  isNativePlatform(): boolean {
    return true;
  }

  getPlatform(): 'electron' {
    return 'electron';
  }

  isPluginAvailable(pluginName: string): boolean {
    // 'LlamaCpp' is PLUGIN_REGISTRY['inference'].pluginName (src/core/support/support-checker.ts,
    // ADR 0005) — every other capability's registered plugin name is irrelevant on Electron since
    // there's no Capacitor plugin registry here at all; sql/download/fs are always real Node.
    if (pluginName !== 'LlamaCpp') return true;
    try {
      const resourcesPath = this.desktop.getResourcesPathForApp(this.app);
      this.desktop.assertSidecarBinary(resourcesPath);
      return true;
    } catch {
      return false;
    }
  }
}
