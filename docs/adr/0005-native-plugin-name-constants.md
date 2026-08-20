# 0005. Native plugin registration-name constants (Phase 0 spike 0.5)

**Status:** accepted
**Date:** 2026-08-10
**TZ section(s):** §6.1

## Context

`Capacitor.isPluginAvailable(pluginName)` matches against the exact string a native plugin registers
itself under (`@CapacitorPlugin(name = "...")` on Android, `jsName`/bridged identifier on iOS — the
two must match by Capacitor convention, and both were independently confirmed identical for all four
plugins in this project by reading each package's native source directly, not its README):

| Capability | Plugin package | Registration name | Android source | iOS source |
|---|---|---|---|---|
| `inference` | `llama-cpp-pro@0.2.4` (formerly `llama-cpp-capacitor@0.1.5`, same package renamed — ADR 0008) | `'LlamaCpp'` | `LlamaCppPlugin.java:20` | `LlamaCppPlugin.swift` (`CAPBridgedPlugin`) |
| `sql`/`vectorSearch` | `@capacitor-community/sqlite@8.1.1` | `'CapacitorSQLite'` | `CapacitorSQLitePlugin.java:22` | `CapacitorSQLitePlugin.swift:9` (`jsName`) |
| `download` | `@capgo/capacitor-downloader@8.1.31` | `'CapacitorDownloader'` | `CapacitorDownloaderPlugin.java:23` | `CapacitorDownloaderPlugin.swift:13` (`jsName`) |
| `deviceInfo` | `@capgo/capacitor-device-info@8.0.10` | `'DeviceInfo'` | `DeviceInfoPlugin.java:14` | `DeviceInfoPlugin.swift:11` (`jsName`) |

These are exact `grep` hits on the installed packages' native source under `node_modules/<pkg>/{android,ios}`,
not guesses from documentation. Two capabilities (`sql`, `vectorSearch`) share one plugin
(`CapacitorSQLite`) since `sqlite-vec` is loaded as a runtime extension *inside* that plugin's
connection, not a separate native plugin (ADR 0002).

Web-support matrix, from the presence/absence of each package's `src/web.ts`:

| Plugin | Ships `src/web.ts`? |
|---|---|
| `llama-cpp-pro` (formerly `llama-cpp-capacitor`) | No |
| `@capacitor-community/sqlite` | Yes (via `jeep-sqlite`) |
| `@capgo/capacitor-downloader` | No |
| `@capgo/capacitor-device-info` | No |

## Decision

`src/core/support/support-checker.ts` (task 1.3) uses this exact table as a constant (not a
placeholder), keyed by `Capability`:

```ts
const PLUGIN_REGISTRY: Record<Capability, { pluginName: string; required: boolean; webSupported: boolean }> = {
  inference:    { pluginName: 'LlamaCpp',            required: true,  webSupported: false },
  sql:          { pluginName: 'CapacitorSQLite',     required: true,  webSupported: true  },
  vectorSearch: { pluginName: 'CapacitorSQLite',     required: false, webSupported: true  },
  download:     { pluginName: 'CapacitorDownloader', required: true,  webSupported: false },
  deviceInfo:   { pluginName: 'DeviceInfo',          required: false, webSupported: false },
};
```

`capabilities.inference` is `false` whenever `platform === 'web'` **or**
`!isPluginAvailable('LlamaCpp')`, per TZ §6.1's degradation rule; `sql`/`download` follow the same
rule using their own `webSupported`/plugin-name pair instead of a blanket web check;
`vectorSearch`'s `required: false` means its absence doesn't populate `missingPlugins` as blocking —
it only affects whether `VectorStore` picks sqlite-vec vs. brute-force (ADR 0002), never
`checkSupport()`'s overall verdict.

## Consequences

- Unblocks ROADMAP task 1.3 (`SupportChecker`) directly — no more placeholder constants file needed.
- If a future plugin swap changes a registration name (e.g. switching away from
  `llama-cpp-capacitor`), this table is the single place to update; `SupportChecker`'s logic itself
  never hardcodes a string outside this constant.
- Residual risk: registration names are read from the *currently installed* package versions
  (pinned in `package.json`); a major-version bump of any of these four plugins should re-grep its
  native source before assuming the name is unchanged — cheap to re-verify, not worth automating yet.
