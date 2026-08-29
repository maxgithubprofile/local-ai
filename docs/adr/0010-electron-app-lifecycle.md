# 0010. Electron app-lifecycle event mapping (Phase 0 spike ELEC.0.3)

**Status:** accepted (event names/signatures confirmed against the real installed `electron@44.0.0`
type declarations, `node_modules/electron/electron.d.ts`, added to this repo's `devDependencies`
specifically to make this verifiable rather than assumed from memory; behavioral firing order in a
real running Electron app not exercised — no Electron app/display available in this environment)
**Date:** 2026-08-29
**TZ section(s):** v6 §11.3

## Context

`AppLifecyclePort` (`src/core/ports/app-lifecycle.port.ts`) is deliberately minimal:

```ts
export interface AppLifecyclePort {
  onStateChange(cb: (state: { isActive: boolean }) => void): Unsubscribe;
}
```

`ROADMAP.md`'s ELEC.0.3 asked which Electron `app` events map onto this, and whether
`releaseRuntime()` should auto-fire on any of them. **`electron` was not previously installed
anywhere in this repo or its dependency tree** (confirmed: `find node_modules -iname "electron*"`
returned nothing before this spike) — added as a `devDependency` (`electron@44.0.0`, mirroring the
existing precedent where `@capacitor/app`/`@capgo/capacitor-device-info`/etc. are also
`devDependencies` here specifically so their real adapters can be written/type-checked against real
types, not just README prose) so this spike's event names could be checked against the real shipped
`.d.ts` rather than trained-knowledge recall.

Confirmed real, in `node_modules/electron/electron.d.ts`, all on the `App` interface (`app` is its
singleton instance):
- `'before-quit'` (line 202) / `'will-quit'` (997) — both `(event: Event) => void`, fire once per
  quit sequence, `event.preventDefault()` can cancel.
- `'window-all-closed'` (1012) — `() => void`, fires when every `BrowserWindow` closes (does *not*
  itself quit the app on macOS, by platform convention).
- `'browser-window-blur'`/`'browser-window-focus'` (210/236) — fire on *any* window losing/gaining
  focus, not scoped to a specific window.
- `BrowserWindow.getFocusedWindow(): BrowserWindow | null` (static, line 5449) — lets a listener
  disambiguate "focus moved to another window of this same app" from "the whole app lost focus" in
  one synchronous call, avoiding a naive blur-then-focus flicker on multi-window apps.

Real, already-shipped evidence this library's own already-depended-on plugin already made a
lifecycle decision here: `llama-cpp-pro/desktop/src/main/ipc-handlers.cjs:192-196` —

```js
if (opts && opts.app) {
  opts.app.on('before-quit', () => { manager.stop().catch(() => {}); });
}
```

— confirms `'before-quit'` is the event the sidecar's own author chose to stop the native process
before the app exits, independent of any window state. This is strong, real precedent (not
guesswork) that `local-ai`'s own process-teardown hook should use the same event for the same reason
(the sidecar and `local-ai`'s runtime context both need to release before the process is gone).

## Decision

Two separate, independent hooks — process-exit cleanup and foreground/background signal are not the
same concern on desktop, unlike how they're conflated on mobile (TZ §11.1's `AppLifecyclePort` was
designed around mobile's "backgrounded ⇒ may be killed any moment" model):

1. **`'before-quit'` → unconditional, non-optional runtime release.** Wired directly in
   `ElectronAppLifecycleAdapter`'s constructor (not gated behind `autoUnloadOnBackground`, since
   there's no plausible reason to leave a sidecar process orphaned on exit) — calls
   `LifecycleManager.releaseRuntime()` once, best-effort (mirrors the sidecar's own `.catch(() => {})`
   swallow — a failed release must never block the app from actually quitting).
2. **`onStateChange(cb)` → `'browser-window-blur'`/`'browser-window-focus'`, debounced against
   `BrowserWindow.getFocusedWindow()`.** On either event, compute
   `isActive = BrowserWindow.getFocusedWindow() !== null` and only invoke `cb()` if that boolean
   actually changed since the last call — this is what makes the port's single `isActive` boolean
   correct for a multi-window app instead of flickering `false`→`true` every time focus moves between
   two of the app's own windows.

`autoUnloadOnBackground` (TZ §11.2) **keeps its existing default of `false` on Electron, same as
mobile** — but the product reasoning for *why* a user might still opt in differs: on mobile the OS can
kill a backgrounded process at any time, so eagerly releasing is a defensive move; on desktop nothing
forces a release, so opting in is purely a memory-reclaiming preference for a user who alt-tabs away
for long stretches. `ROADMAP.md`'s own existing text already reasoned toward "stay purely explicit-call
on desktop" for the *auto-release-on-background* half — this ADR narrows that to just the
`onStateChange` signal, and separately confirms `'before-quit'` should fire unconditionally regardless
of that setting, which the original task text hadn't distinguished.

## Consequences

- Unblocks ELEC.1.4 (`ElectronAppLifecycleAdapter`) with a concrete, type-checked-against-real-`.d.ts`
  implementation.
- `LifecycleManager` (`src/core/runtime/lifecycle-manager.ts`) needs one new capability: a
  process-exit-triggered `releaseRuntime()` call independent of `enableAutoUnloadOnBackground()`'s
  existing on/off switch. Simplest shape: `ElectronAppLifecycleAdapter` itself calls
  `lifecycleManager.releaseRuntime()` directly from its `'before-quit'` handler (it already has a
  reference at construction, same pattern `CapacitorAppLifecycleAdapter` doesn't need since mobile has
  no analogous "the whole process is about to disappear" event) — no core-layer port change required,
  this stays adapter-local.
- Real device-e2e-equivalent risk: `'browser-window-blur'`/`'browser-window-focus'`'s actual firing
  order and timing (does Electron fire blur before or after focus when switching between two of the
  app's own windows? is there a synchronous gap where `getFocusedWindow()` briefly returns `null`
  during the switch?) is only confirmed against the type declarations, not observed in a running app —
  needs `ELEC.1.5`'s Electron-native test runner to actually exercise before treating the debounce
  logic above as bulletproof rather than merely plausible.
- If `'before-quit'`'s best-effort release throws in a way that blocks quit despite the `.catch()`
  swallow (e.g. a `preventDefault()` call was accidentally left in from local development), that's a
  regression this ADR's design explicitly guards against — the release must be fire-and-forget from
  quit's perspective, never `await`ed in a way that could delay `app.quit()`.
