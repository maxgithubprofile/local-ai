# Logging and export

Not a TZ §15 phase — TZ §14 only specifies a pass-through `logger?: LocalAiLogger` callback, no-op by
default. This guide covers that callback plus the separate, opt-in **persisted** log store added
2026-08-11 (ROADMAP.md's "Local logging & export" section; reasoning in `docs/decisions.md`'s entry
of the same name). The two are independent — read both halves below before assuming one implies the
other.

## `config.logger` — the pluggable callback

```ts
const client = await LocalAiClient.create({
  manifestUrl,
  ports,
  logger: {
    debug: (message, meta) => myLogger.debug(message, meta),
    info: (message, meta) => myLogger.info(message, meta),
    warn: (message, meta) => myLogger.warn(message, meta),
    error: (message, meta) => myLogger.error(message, meta),
  },
});
```

No-op by default (TZ §14 — never `console.log` in the library's production code). When supplied, it's
called for **every** `LocalAiEventMap` event `local-ai` emits internally (`manifest:invalid`,
`download:failed`, `device:eligibility-warning`, `runtime:*`, `vector-store:fallback-active`,
`chat-search:fallback-active`, …) plus a handful of `RuntimeInitError`/`DeviceNotEligibleError` sites
that throw without a corresponding event. `message` is the event name (or a short description for the
non-event sites); `meta` is the event payload, with the real `Error` object intact where relevant — no
JSON-safety constraint here, it's an in-process function call. This fires **regardless of whether
`config.logging` (below) is set** — the callback and the persisted store are independent features.

## `config.logging` — the persisted log store

```ts
const client = await LocalAiClient.create({
  manifestUrl,
  ports,
  logging: { enabled: true, minLevel: 'info', maxEntries: 5000 }, // defaults shown explicitly
});
```

Off by default (`enabled: false`) — this was a deliberate opt-in choice, not a `logger`-style
no-op-until-configured default; see `docs/decisions.md` for why. When enabled, every internal log
event at or above `minLevel` is appended to a local SQLite table (`logs`, `LogStore`), bounded to the
most recent `maxEntries` rows (oldest pruned automatically on each write — never grows unbounded).

`minLevel` is a severity **threshold**, not an exact match: `'warn'` keeps `warn` and `error` entries,
drops `debug`/`info`. Same rule applies to `exportLogs()`'s `level` filter below.

One event — `download:progress` — never reaches the persisted store even with `minLevel: 'debug'`. It
fires many times per download; persisting every tick would blow through `maxEntries` almost instantly
and evict everything else. The `logger` callback above still receives it.

## Reading it back — `exportLogs()` / `clearLogs()`

```ts
const recent = await client.exportLogs({ limit: 100 });
const errorsOnly = await client.exportLogs({ level: 'error' });
const sinceYesterday = await client.exportLogs({ since: new Date(Date.now() - 24 * 60 * 60 * 1000) });

await client.clearLogs(); // wipes the persisted store; does not affect the logger callback
```

`exportLogs()` returns plain `LogEntry[]` objects (`{ id, ts, level, message, meta? }`), oldest first.
Like `exportChat()`/`exportChats()` (Phase 8), this is deliberately **data only** — no file write, no
share-sheet call from inside the library. The host app decides how to turn it into a file and hand it
to a native save/share flow; `local-ai` has no opinion on native share UX (hexagonal boundary,
CLAUDE.md).

## What not to put in `meta`

`config.logger`'s callback and `config.logging`'s persisted store have **different** safety contracts,
even though they're fed from the same internal call sites:

- **`logger` callback** — an in-process function call. `meta` carries the real `Error` object intact,
  no JSON-safety constraint (TZ §14). Fine to log anything here that your own app-side logger already
  handles responsibly.
- **`logging` persisted store / `exportLogs()`** — `meta` is stored as `JSON.stringify`d text in a
  local SQLite table, and is explicitly designed to leave the device (the intended use is a host-app
  "export logs" button feeding a share sheet, see below). Anything written here should be treated as
  **eventually user-shareable data**, not an internal debug artifact.

Concretely, avoid passing these into anything that reaches the persisted store:

- Full eligibility/device snapshots (`EligibilityReport.device`, `DeviceSnapshot`) — these include raw
  RAM/thermal/storage figures for the specific physical device; fine for your own crash-reporting
  pipeline, not necessarily fine to hand a user a JSON file containing.
- Raw `Error` objects passed through unfiltered — stack traces can incidentally contain local file
  paths, and some runtime errors may embed partial prompt/completion content. Prefer `error.message`
  plus a stable `code` (every `LocalAiError` subclass has one, CLAUDE.md) over the whole object.
- Any chat/message content or embeddings — `local-ai`'s own internal log call sites never do this
  today, but a consumer app building its own logging on top of `config.logger`/`config.logging` should
  apply the same rule to its own log calls.

If you need the richer, unfiltered version for your own crash reporting, use `config.logger` (in-memory
only) for that and keep `config.logging`/`exportLogs()` reserved for what you're comfortable a user
literally sees after tapping "export logs".

## Wiring an "Export logs" button

```ts
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share'; // or whichever share plugin the app already uses

async function exportLogsToFile() {
  const entries = await client.exportLogs();
  const json = JSON.stringify(entries, null, 2);
  const { uri } = await Filesystem.writeFile({
    path: `local-ai-logs-${Date.now()}.json`,
    data: json,
    directory: Directory.Cache,
    encoding: 'utf8',
  });
  await Share.share({ url: uri, title: 'local-ai logs' });
}
```

See `examples/minimal-capacitor-app/` for this wired to an actual button.
