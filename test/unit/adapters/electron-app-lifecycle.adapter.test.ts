import type { App, BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { ElectronAppLifecycleAdapter } from '../../../src/adapters/electron/electron-app-lifecycle.adapter.js';

/** Minimal fake matching the real `electron@44.0.0` `App`'s `on`/`off` shape (ADR 0010). */
function fakeApp(): Pick<App, 'on' | 'off'> & { fire(event: string): void } {
  const listeners = new Map<string, Set<() => void>>();
  const raw = {
    on: vi.fn((event: string, listener: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    off: vi.fn((event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    }),
    fire(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
  return raw as unknown as Pick<App, 'on' | 'off'> & { fire(event: string): void };
}

/** A fake "window" object is enough — `getFocusedWindow()`'s callers only check `!== null`. */
function fakeBrowserWindowStatics(getFocusedWindow: () => object | null): Pick<typeof BrowserWindow, 'getFocusedWindow'> {
  return { getFocusedWindow: getFocusedWindow as () => BrowserWindow | null };
}

describe('ElectronAppLifecycleAdapter', () => {
  it('reports isActive: false only once when focus genuinely moves to no window (blur with no focused window)', () => {
    const app = fakeApp();
    let focused: object | null = {};
    const bw = fakeBrowserWindowStatics(() => focused);
    const adapter = new ElectronAppLifecycleAdapter(app, bw);
    const cb = vi.fn();
    adapter.onStateChange(cb);

    focused = null;
    app.fire('browser-window-blur');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ isActive: false });
  });

  it('does not fire when focus moves between two of the app\'s own windows (blur immediately followed by focus, still active)', () => {
    const app = fakeApp();
    const focused = {};
    const bw = fakeBrowserWindowStatics(() => focused);
    const adapter = new ElectronAppLifecycleAdapter(app, bw);
    const cb = vi.fn();
    adapter.onStateChange(cb);

    app.fire('browser-window-blur');
    app.fire('browser-window-focus');

    expect(cb).not.toHaveBeenCalled();
  });

  it('reports isActive: true when focus returns after genuinely leaving', () => {
    const app = fakeApp();
    let focused: object | null = {};
    const bw = fakeBrowserWindowStatics(() => focused);
    const adapter = new ElectronAppLifecycleAdapter(app, bw);
    const cb = vi.fn();
    adapter.onStateChange(cb);

    focused = null;
    app.fire('browser-window-blur');
    focused = {};
    app.fire('browser-window-focus');

    expect(cb).toHaveBeenNthCalledWith(1, { isActive: false });
    expect(cb).toHaveBeenNthCalledWith(2, { isActive: true });
  });

  it('unsubscribe stops further callbacks', () => {
    const app = fakeApp();
    let focused: object | null = {};
    const bw = fakeBrowserWindowStatics(() => focused);
    const adapter = new ElectronAppLifecycleAdapter(app, bw);
    const cb = vi.fn();
    const unsubscribe = adapter.onStateChange(cb);
    unsubscribe();

    focused = null;
    app.fire('browser-window-blur');

    expect(cb).not.toHaveBeenCalled();
  });

  it('calls the onBeforeQuit callback unconditionally on before-quit, independent of onStateChange', () => {
    const app = fakeApp();
    const bw = fakeBrowserWindowStatics(() => null);
    const onBeforeQuit = vi.fn();
    new ElectronAppLifecycleAdapter(app, bw, onBeforeQuit);

    app.fire('before-quit');

    expect(onBeforeQuit).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejecting onBeforeQuit rather than throwing, so quit is never blocked', async () => {
    const app = fakeApp();
    const bw = fakeBrowserWindowStatics(() => null);
    const onBeforeQuit = vi.fn().mockRejectedValue(new Error('release failed'));
    new ElectronAppLifecycleAdapter(app, bw, onBeforeQuit);

    expect(() => app.fire('before-quit')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onBeforeQuit).toHaveBeenCalledTimes(1);
  });

  it('does not register a before-quit listener when onBeforeQuit is omitted', () => {
    const app = fakeApp();
    const bw = fakeBrowserWindowStatics(() => null);
    new ElectronAppLifecycleAdapter(app, bw);

    expect(app.on).not.toHaveBeenCalledWith('before-quit', expect.anything());
  });
});
