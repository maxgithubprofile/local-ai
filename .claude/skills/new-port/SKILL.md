---
name: new-port
description: Scaffold a new hexagonal port for local-ai — the port interface plus a symmetric prod (Capacitor) adapter, a Node-testing adapter, and a parametrized contract test. Use when the TZ or a task requires a new capability that core needs to reach a platform through (a new native plugin, a new I/O boundary) that isn't one of the 9 existing ports in src/core/ports/.
---

# new-port

Encodes the hexagonal pattern from `docs/2026-08-10-local-ai-library-tz.md` §3 so a new port is
never added asymmetrically (interface with only one implementation, or an adapter with no contract
test).

## Steps

1. **Confirm it's actually new.** Check `src/core/ports/index.ts` — the 9 existing ports
   (`PlatformSupportPort`, `DeviceInfoPort`, `DownloadTransportPort`, `FileSystemPort`,
   `SqlitePort`, `LlmRuntimePort`, `ClockPort`, `HashPort`, `AppLifecyclePort`) cover everything the
   TZ specifies. A genuinely new port is rare post-bootstrap — prefer extending an existing port's
   interface if the capability fits its purpose.

2. **Define the port** in `src/core/ports/<name>.port.ts` — a pure TypeScript interface, JSDoc'd,
   zero implementation, zero imports outside `src/core/**`. Add it to `LocalAiPorts` in
   `src/core/ports/index.ts`.

3. **Add a production adapter stub** in `src/adapters/capacitor/<name>.adapter.ts` implementing the
   port, each method throwing `not implemented` with a comment pointing at the owning TZ section and
   ROADMAP phase (match the style of the existing adapter stubs). Export it from
   `src/adapters/capacitor/index.ts`.

4. **Add a Node-testing adapter stub** in `src/adapters/node-testing/<name>.adapter.ts`, same
   pattern (fake/in-memory or a real Node-native implementation, depending on what the port needs).
   Export it from `src/adapters/node-testing/index.ts`.

5. **Add a contract test skeleton** in `test/contract/<name>.contract.ts` — one `describe.each`
   (or equivalent) block of scenarios that both adapters must satisfy identically, following the
   existing pattern in `test/contract/` if one exists yet, or TZ §13.3's description otherwise.

6. Update `CLAUDE.md`'s port list and `ROADMAP.md` if this port belongs to a specific phase.

## Non-negotiable

Never land a port with only one adapter, and never land an adapter without updating its subpath's
`index.ts` barrel — both break the "core never imports a concrete adapter" guarantee this pattern
exists to protect.
