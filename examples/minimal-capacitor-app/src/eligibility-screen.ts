/**
 * "Device not supported / not eligible" screen — TZ §6. Call
 * `checkAppCanRun()` at boot, before `getClient()`; if it returns a
 * non-null reason, show that instead of the chat UI. This is the one place
 * in the example app that talks to `checkSupport()` directly rather than
 * through `getClient()`, since it's designed to be answerable *before*
 * committing to `LocalAiClient.create()` at all.
 */
import { LocalAiClient } from 'local-ai';
import { CapacitorPlatformSupportAdapter } from 'local-ai/adapters/capacitor';

export interface UnsupportedReason {
  title: string;
  detail: string;
}

/**
 * Environment-only check (TZ §6.1) — no manifest/network needed, safe at
 * app boot. Returns `null` if the build can run `local-ai` at all; device
 * *eligibility* for the specific configured model (TZ §6.2) is checked
 * separately, later, via `client.checkDeviceEligibility()` once a manifest
 * is available — see `chats.ts`'s use of `ensureModelReady()`, which
 * enforces that gate itself per `eligibilityPolicy`.
 */
export async function checkAppCanRun(): Promise<UnsupportedReason | null> {
  const support = await LocalAiClient.checkSupport({
    platformSupport: new CapacitorPlatformSupportAdapter(),
  });

  if (!support.capabilities.inference) {
    return {
      title: 'On-device AI is not available on this device',
      detail: support.reasons.join(' '),
    };
  }
  return null;
}

/**
 * Renders the "device not eligible" screen for a *specific* eligibility
 * verdict (called after `ensureModelReady()`/`ensureEmbeddingReady()`
 * throws `DeviceNotEligibleError`, or from a `device:eligibility-warning`
 * event handler for the non-blocking 'tight' case) — distinct from
 * {@link checkAppCanRun}'s build-level check.
 */
export function describeEligibilityFailure(reasons: string[]): UnsupportedReason {
  return {
    title: 'This device may struggle to run the on-device model',
    detail: reasons.join(' '),
  };
}
