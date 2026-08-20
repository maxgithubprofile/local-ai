# 0008. `llama-cpp-capacitor` → `llama-cpp-pro` migration

**Status:** accepted
**Date:** 2026-08-20
**TZ section(s):** §4.1, §9.3, §16.19 (supersedes nothing in ADR 0001 — the API it documented is
unchanged, only the npm package name and version)

## Context

Comparing alternatives to the pinned native inference plugin during `forta.chat`'s perf-tuning work
surfaced `llama-cpp-pro`. Per this repository's own ADR 0001 principle ("don't trust the README,
check the real package"), it was verified against the **actual unpacked tarball**
(`npm pack llama-cpp-pro@0.2.4`, read line by line) rather than its README, and compared directly
against the already-installed `llama-cpp-capacitor@0.1.5` in `node_modules`. Full investigation:
`docs/2026-08-20-llama-cpp-pro-migration-plan.md`.

Findings:

1. **Same project, renamed.** `llama-cpp-pro`'s `CHANGELOG.md` `[Unreleased]` section states the npm
   package and GitHub repo were renamed from `llama-cpp-capacitor` (`annadata-llama-cpp`); the old
   name's publishes remain available on npm. Same author (`ai.annadata`/arusatech), same Java package
   (`ai.annadata.plugin.capacitor`), same plugin registration (`@CapacitorPlugin(name = "LlamaCpp")`
   — matches ADR 0001's finding exactly).
2. **TS API byte-identical.** `diff` of both packages' `types/*.d.ts` (after normalizing the module
   name) produced zero differences — `initLlama()`, `LlamaContext`, `ContextParams`,
   `CompletionParams`, every field, unchanged.
3. **Android build config identical.** `android/build.gradle` (`minSdkVersion`/`compileSdk`/NDK
   `29.0.13113456`/`abiFilters 'arm64-v8a'`) and `android/src/main/CMakeLists-arm64.txt` (same
   CPU-only source list, `-DLM_GGML_USE_CPU -DLM_GGML_CPU_GENERIC`, Cortex-A76 tuning) are unchanged
   between the two packages. `minSdk 24` (Android 7, `forta.chat/CLAUDE.md`'s floor) is unaffected.
4. **GPU on Android still absent in both.** Neither package compiles `ggml-vulkan`/`ggml-opencl`/
   `ggml-cuda` into the Android `.so` — `llama-cpp-pro` gained `ggml-metal.*` (iOS/macOS only) and a
   `cmake/ggml-backends.cmake` that can build Vulkan/CUDA/HIP backends, but only for a desktop
   Electron sidecar, entirely outside the Android build. This migration changes nothing about
   Android inference speed.
5. **`.so` size:** `llama-cpp-capacitor`'s precompiled `arm64-v8a` `libllama-cpp-arm64.so` is
   58 354 360 bytes (~58.3 MB, unstripped). `llama-cpp-pro`'s is 7 095 896 bytes (~6.8 MB, stripped —
   `CHANGELOG.md` `[0.2.1]`: "Build only arm64-v8a for Android (drop armeabi-v7a); strip iOS
   framework and Android `.so` debug symbols"). Uncompressed ratio only; the compressed-in-APK ratio
   needs its own measurement (§ Consequences).
6. **Real Android bug fixes landed in `[0.2.1]`** that `0.1.5` predates: `loadSession`/`saveSession`
   were "returning hardcoded zeros" on Android/iOS (now backed by
   `llama_state_load_file`/`llama_state_save_file`); completion parameter propagation on Android
   extracted only `temperature`/`n_predict`/`prompt` from the JS object before `0.2.1`, now forwards
   all 20+ sampling parameters.
7. **Documentation gap `0.2.2`–`0.2.4`:** `CHANGELOG.md`'s last dated entry is `[0.2.1]`
   (2025-07-07); the installed `0.2.4` postdates it with no changelog coverage. The `.d.ts`/build-file
   diff was done directly against `0.2.4` (not the intermediate versions), so that diff is the
   verified ground truth, not the changelog prose.
8. **Correction found during implementation, not in the original migration-plan doc:** the
   migration-plan's "byte-identical `.d.ts`" claim (finding 2 above) compared the tarball's stray
   legacy `types/llama-cpp-pro.d.ts` — **not** the file `package.json`'s `exports` map actually
   resolves for consumers (`dist/esm/index.d.ts`). Those two disagree: the real resolved entry point
   does **not** export `LlamaCppOAICompatibleMessage`/`LlamaCppMessagePart` by that name — only under
   legacy aliases `RNLlamaOAICompatibleMessage`/`RNLlamaMessagePart` (structurally identical types,
   different exported name). `tsc --noEmit` caught this immediately (`TS2724`). Fixed by importing
   `RNLlamaOAICompatibleMessage as LlamaCppOAICompatibleMessage` in the adapter (see its own comment)
   — no behavior change, since the underlying shape is unchanged, only the name TS sees it under.
   Recorded here because it's exactly the failure mode ADR 0001's own principle warns about: a
   package's shipped file that *looks* authoritative can still not be the one actually in effect —
   the fix is to check what `exports`/`types` in `package.json` really resolves to, not just grep the
   tarball for a `.d.ts` file that happens to be there.
9. **A second correction, more serious — not covered by the migration-plan doc at all:**
   `forta.chat` carries `patches/llama-cpp-capacitor+0.1.5.patch` (`patch-package`, applied via
   `postinstall`), fixing two live-crash/live-hang Android bugs in `jni.cpp` found and fixed
   2026-08-19, **before** this migration plan was written and **not mentioned anywhere in it**:
   (a) `string_to_jstring()` passed unsanitized model output straight to `NewStringUTF()`, which
   aborts the whole app process on invalid Modified UTF-8 — reachable any time a byte-level
   tokenizer's output doesn't land on a clean UTF-8 boundary (observed live); (b) the Android
   completion loop's end-of-generation check was a hardcoded `token_output.tok == 2`, not the
   model's real EOG token(s), so on this device every single reply ran the *entire* `n_predict`
   budget regardless of how short the real answer was (minutes per reply, even for "hi") instead of
   stopping when `nextToken()` already knows generation is done (`has_next_token`). Checked directly
   against the installed `llama-cpp-pro@0.2.4`'s `android/src/main/jni.cpp`: **both bugs are still
   present, byte-for-byte the same code** — neither was upstreamed between `0.1.5` and `0.2.4`.
   (`cap-ios-bridge.cpp` in this same package already checks `has_next_token` correctly; only the
   Android JNI loop doesn't — a same-package inconsistency, not something particular to the fork.)
   Migrating to `llama-cpp-pro` without carrying this patch forward would have **reintroduced both
   bugs**, silently, since a plain dependency bump gives `patch-package` nothing to apply against
   (`postinstall` errored: "Patch file found for package llama-cpp-capacitor which is not present").
   **Action taken:** both fixes ported verbatim into `llama-cpp-pro`'s copy of `jni.cpp` (same
   surrounding code, only line numbers shifted — confirmed by reading the file directly, not
   assumed), then re-captured as `patches/llama-cpp-pro+0.2.4.patch` via `npx patch-package
   llama-cpp-pro`; the old `llama-cpp-capacitor+0.1.5.patch` was deleted. Verified with a clean
   `npx patch-package` re-apply (exits `✔` with no error). **This patch must be revisited if
   `llama-cpp-pro` is ever bumped past `0.2.4`** — same discipline as any vendored fix: re-check
   whether the upstream file changed underneath it.

What is verified in this environment: static package contents (types, native build files, changelog
text, `.so` size on disk). What is **not** verified here and needs a real device (TZ §13's
no-phone-no-shortcut rule): whether `saveSession`/`loadSession` actually round-trip KV-cache state on
Android now, whether the `n_predict = 50` JNI substitution bug (`runtime-facade.ts`'s comment) is
gone, and the real compressed APK-size delta.

## Decision

Migrate the pinned native inference dependency from `llama-cpp-capacitor@^0.1.5` to
`llama-cpp-pro@^0.2.4` in both `local-ai` and its `forta.chat` consumer. Concretely:

- `local-ai`'s `package.json`: `peerDependencies`/`peerDependenciesMeta`/`devDependencies` swapped to
  `llama-cpp-pro` (`>=0.2.4`/`^0.2.4`).
- `src/adapters/capacitor/llama-cpp-capacitor.adapter.ts`: only the import source changed
  (`'llama-cpp-capacitor'` → `'llama-cpp-pro'`); adapter logic is untouched since the API is
  byte-identical. File name and class name (`LlamaCppCapacitorAdapter`) are **deliberately kept
  as-is** — renaming is a separate, optional cleanup (tracked, not required for this migration; the
  Capacitor plugin registration name stays `'LlamaCpp'` regardless of the npm package or wrapper
  class name).
- Doc comments that describe the *current* API/package by name were updated
  (`llm-runtime.port.ts`, `reasoning-content.ts`, `async-token-queue.ts`, the adapter's own header).
  Comments describing a **dated, version-specific historical bug** (`runtime-facade.ts`'s
  `n_predict = 50` note, the adapter's `minja` jinja-fallback note) were left describing what was
  observed on `llama-cpp-capacitor@0.1.5`, with a note that re-verification on `0.2.4` needs a device
  — not rewritten to claim a fix that hasn't been confirmed.
- `forta.chat`'s `package.json` dependency bumped the same way; `npx cap sync android` regenerates
  the Capacitor-owned autogenerated files (`capacitor.settings.gradle`,
  `capacitor.build.gradle`, `capacitor.plugins.json`).

## Consequences

- Unblocks `forta.chat`'s perf-tuning plan, which is now sequenced to run **after** this migration
  (its own doc updated accordingly) — if `0.1.5` really only forwarded 3 of the sampling parameters
  on Android, most of that plan's parameter work would have been measuring a no-op on the old
  package.
- **Before this migration is considered complete**, the following need a real device
  (`forta.chat`'s `device-ai-loop.md`), not just `npm test`:
  1. Session-persistence timing comparison (first-token latency, message 1 vs. message 2 in the same
     chat) — before/after, to confirm `SessionCache` actually benefits.
  2. APK size delta, recorded into `forta.chat`'s `docs/plans/llama2/decisions.md` next to the
     existing "+24 MB" measurement.
  3. Full `device-ai-loop.md` smoke pass (download → load → send → stream → cancel → switch chats).
  4. Re-check whether the jinja `minja` destructure bug (adapter's fallback-retry comment,
     2026-08-19) still reproduces.
  5. Re-check the `n_predict = 50` JNI substitution bug (`runtime-facade.ts`). If confirmed fixed,
     `RuntimeFacade`'s `DEFAULT_COMPLETION_MAX_TOKENS` choke point is kept regardless — it protects
     against any plugin's undocumented default, not just this one.
- **Rollback:** trivial — both npm names remain published (`llama-cpp-capacitor`'s publishes are not
  being pulled per its own changelog), so reverting is `package.json` back to
  `llama-cpp-capacitor@^0.1.5` + reinstall + `cap sync`, no data migration involved.
- Resolves nothing in `docs/decisions.md` directly (no open question there names this); ADR 0001
  remains the authoritative API-shape reference — this ADR only supersedes the package name/version
  it was written against.
