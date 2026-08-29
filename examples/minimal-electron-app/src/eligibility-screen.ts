/**
 * "Can this build even run local-ai at all" screen — TZ §6.1,
 * checked before `create()`, no network/manifest needed. Mirrors
 * `minimal-capacitor-app/src/eligibility-screen.ts`'s shape; the concrete
 * capability that's actually `false` on Electron today is different
 * (`inference`, per docs/adr/0011) but the pattern — check, then decide
 * what to show — is identical across platforms.
 */
import { app } from 'electron';
import { LocalAiClient } from 'local-ai';
import { ElectronPlatformSupportAdapter } from 'local-ai/adapters/electron';
import * as desktop from 'llama-cpp-pro/desktop';

export interface UnsupportedScreen {
  title: string;
  detail: string;
}

/** Returns a screen description if the app can't run local-ai at all here, `null` if it can. */
export async function checkAppCanRun(): Promise<UnsupportedScreen | null> {
  const support = await LocalAiClient.checkSupport({
    platformSupport: new ElectronPlatformSupportAdapter(app, desktop),
  });

  if (!support.capabilities.inference) {
    // Expected on every Electron build today — see docs/adr/0011-electron-sidecar-build.md.
    // A real app might show a "chat isn't available yet, other features are" screen rather
    // than blocking entirely, since sql/download/deviceInfo are all still available.
    return {
      title: 'Chat isn\'t available on this build',
      detail: support.reasons.join(' '),
    };
  }

  return null;
}
