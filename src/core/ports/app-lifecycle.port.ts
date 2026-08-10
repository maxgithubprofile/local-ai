import type { Unsubscribe } from '../types.js';

/**
 * App foreground/background signal, used only when `autoUnloadOnBackground`
 * is opted into (TZ §11.2). Production adapter wraps
 * `App.addListener('appStateChange', ...)` from `@capacitor/app`.
 */
export interface AppLifecyclePort {
  onStateChange(cb: (state: { isActive: boolean }) => void): Unsubscribe;
}
