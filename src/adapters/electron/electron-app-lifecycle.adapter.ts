import type { App, BrowserWindow } from 'electron';
import type { AppLifecyclePort } from '../../core/ports/app-lifecycle.port.js';
import type { Unsubscribe } from '../../core/types.js';

/** The narrow slice of Electron's `app`/`BrowserWindow` this adapter actually needs — real shape confirmed against `electron@44.0.0`'s own `.d.ts` in `docs/adr/0010-electron-app-lifecycle.md`. */
type ElectronAppLike = Pick<App, 'on' | 'off'>;
type BrowserWindowStatics = Pick<typeof BrowserWindow, 'getFocusedWindow'>;

/**
 * Real `AppLifecyclePort` for Electron's main process (TZ v6 §11.3,
 * ELEC.1.4, `docs/adr/0010-electron-app-lifecycle.md`). Two independent
 * hooks, not one — see that ADR for why mobile's single-concern port needed
 * splitting for desktop:
 *
 * - `onStateChange()` fires on `'browser-window-blur'`/`'browser-window-focus'`,
 *   debounced against `BrowserWindow.getFocusedWindow()` so moving focus
 *   between two of the app's own windows doesn't flicker `isActive` false
 *   then true.
 * - `onBeforeQuit`, passed to the constructor, fires unconditionally on
 *   `'before-quit'` — independent of whether any `onStateChange()`
 *   subscriber ever ran, since a process exit needs runtime cleanup
 *   regardless of `autoUnloadOnBackground`. Best-effort: a rejection here
 *   is swallowed, matching `llama-cpp-pro/desktop`'s own
 *   `manager.stop().catch(() => {})` precedent for the same event — quit
 *   must never be blocked or delayed by this.
 */
export class ElectronAppLifecycleAdapter implements AppLifecyclePort {
  constructor(
    private readonly app: ElectronAppLike,
    private readonly browserWindow: BrowserWindowStatics,
    onBeforeQuit?: () => Promise<void> | void,
  ) {
    if (onBeforeQuit) {
      this.app.on('before-quit', () => {
        try {
          void Promise.resolve(onBeforeQuit()).catch(() => {});
        } catch {
          // best-effort — quitting must never be blocked by a release failure
        }
      });
    }
  }

  onStateChange(cb: (state: { isActive: boolean }) => void): Unsubscribe {
    let lastIsActive = this.browserWindow.getFocusedWindow() !== null;
    const handler = (): void => {
      const isActive = this.browserWindow.getFocusedWindow() !== null;
      if (isActive === lastIsActive) return;
      lastIsActive = isActive;
      cb({ isActive });
    };
    this.app.on('browser-window-blur', handler);
    this.app.on('browser-window-focus', handler);
    return () => {
      this.app.off('browser-window-blur', handler);
      this.app.off('browser-window-focus', handler);
    };
  }
}
