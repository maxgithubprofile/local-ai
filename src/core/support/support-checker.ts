import type { PlatformSupportPort } from '../ports/platform-support.port.js';
import type { Capability, SupportReport } from './types.js';

/**
 * Native plugin registration-name constants — confirmed by grepping each
 * installed plugin's own native source (Phase 0 spike 0.5,
 * `docs/adr/0005-native-plugin-name-constants.md`), not guessed from
 * documentation. `sql` and `vectorSearch` share one plugin
 * (`CapacitorSQLite`) since `sqlite-vec` loads as a runtime extension
 * inside that plugin's connection rather than as a separate native plugin
 * (`docs/adr/0002-sqlite-vec-load-extension.md`).
 */
export const PLUGIN_REGISTRY: Record<Capability, { pluginName: string; required: boolean; webSupported: boolean }> = {
  inference: { pluginName: 'LlamaCpp', required: true, webSupported: false },
  sql: { pluginName: 'CapacitorSQLite', required: true, webSupported: true },
  vectorSearch: { pluginName: 'CapacitorSQLite', required: false, webSupported: true },
  download: { pluginName: 'CapacitorDownloader', required: true, webSupported: false },
  deviceInfo: { pluginName: 'DeviceInfo', required: false, webSupported: false },
};

/**
 * Builds a {@link SupportReport} from `PlatformSupportPort` per the
 * degradation rule in TZ §6.1: a capability is available only if its plugin
 * is registered **and** (the platform is native OR that specific plugin
 * declares web support). `deviceInfo`/`vectorSearch` being unavailable never
 * populates `missingPlugins` as blocking (`required: false`) — they degrade
 * other features (`EligibilityService`, `VectorStore`) rather than the
 * library as a whole.
 */
export class SupportChecker {
  constructor(private readonly platformSupport: PlatformSupportPort) {}

  async check(): Promise<SupportReport> {
    const isNative = this.platformSupport.isNativePlatform();
    const rawPlatform = this.platformSupport.getPlatform();
    const platform: SupportReport['platform'] =
      rawPlatform === 'ios' || rawPlatform === 'android' || rawPlatform === 'web' ? rawPlatform : 'unknown';

    const capabilities = {} as Record<Capability, boolean>;
    const missingPlugins: SupportReport['missingPlugins'] = [];
    const reasons: string[] = [];

    for (const capability of Object.keys(PLUGIN_REGISTRY) as Capability[]) {
      const entry = PLUGIN_REGISTRY[capability];
      const pluginAvailable = this.platformSupport.isPluginAvailable(entry.pluginName);
      const platformOk = isNative || entry.webSupported;
      const available = pluginAvailable && platformOk;
      capabilities[capability] = available;

      if (!available) {
        missingPlugins.push({ capability, pluginName: entry.pluginName, required: entry.required });
        if (!platformOk) {
          reasons.push(`platform '${platform}' does not support ${entry.pluginName} (capability: ${capability})`);
        } else {
          reasons.push(`required plugin ${entry.pluginName} is not available (capability: ${capability})`);
        }
      }
    }

    return { platform, isNative, capabilities, missingPlugins, reasons };
  }
}
