import { App } from '@capacitor/app';
import type { AppLifecyclePort } from '../../core/ports/app-lifecycle.port.js';
import type { Unsubscribe } from '../../core/types.js';

/**
 * Wraps `App.addListener('appStateChange', ...)` from `@capacitor/app`
 * (TZ §4.6, §11.2). Only consulted when `autoUnloadOnBackground` is opted
 * into (`LifecycleManager.enableAutoUnloadOnBackground()`).
 *
 * `addListener()` is itself async (returns `Promise<PluginListenerHandle>`)
 * but `AppLifecyclePort.onStateChange()` must return an `Unsubscribe`
 * synchronously — the returned closure defers to the pending handle rather
 * than blocking the caller on the native round-trip.
 */
export class CapacitorAppLifecycleAdapter implements AppLifecyclePort {
  onStateChange(cb: (state: { isActive: boolean }) => void): Unsubscribe {
    const handlePromise = App.addListener('appStateChange', (state) => cb({ isActive: state.isActive }));
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      void handlePromise.then((handle) => handle.remove());
    };
  }
}
