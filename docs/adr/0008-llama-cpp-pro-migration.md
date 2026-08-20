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
- **Device verification, real-device pass 2026-08-20** (`forta.chat`'s `device-ai-loop.md`, Qwen3-4B
  Q4_K_M, same phone throughout) — see `docs/decisions.md`'s "Session persistence was permanently
  broken on Android" and "No per-token streaming on Android" entries (2026-08-20) for the two items
  found and fixed earlier in that pass, and `forta.chat`'s own `decisions.md` for the APK-size
  re-measurement (item 2 below). Status of the five original items:
  1. **Session-persistence — fixed and confirmed live**, but the *comparison* this item asked for
     turned out to be the wrong experiment: two messages sent back-to-back in one still-open chat
     reuse the same in-memory `LlamaContext` (no `loadSession` call happens at all — confirmed via
     logcat, only `saveSession` fires, after each turn) so this pair never exercises the disk-based
     `SessionCache.activate()`/`loadSession()` path in the first place. What *was* confirmed: both
     bugs from the "Session persistence was permanently broken" entry are fixed —
     `saveSession` now succeeds and produces a real, growing `.bin` file (25.5 MB after turn 1, 93.2 MB
     after turn 2, correct un-encoded `qwen3-4b:1.bin` filename). What's still open: a genuine
     cold-reload comparison (switch away from the chat or restart the app, then send another message)
     to see whether `loadSession` actually cuts prefill time versus a fully cold context — not done
     in this pass (time budget), tracked in `forta.chat`'s perf-tuning-plan.md §9.
  2. **APK size delta — measured, and it's the opposite of what this ADR expected.**
     `gradlew assembleSideloadDebug --rerun-tasks` (same method as the historical "+24 MB" entry):
     total APK **137,526,865 bytes (~131.2 MB)**, up from `llama-cpp-capacitor@0.1.5`'s
     132,024,519 bytes — **+5.5 MB, not smaller**. `lib/arm64-v8a/libllama-cpp-arm64.so` itself:
     89,395,384 bytes uncompressed / 24,811,281 compressed (up from 68,740,712 / 19,683,547 on
     `0.1.5`). Root cause: this ADR's "`.so` size" finding (item 5, ~6.8 MB stripped) compared the
     **precompiled binary shipped inside the npm tarball** — but Gradle's build for this plugin runs
     `configureCMakeDebug[arm64-v8a]`/`buildCMakeDebug[arm64-v8a]` and genuinely **recompiles the
     native code from source** for a debug APK (confirmed: `stripSideloadDebugDebugSymbols` logs
     "Unable to strip... libllama-cpp-arm64.so... packaging them as they are" — an unstripped
     Debug-config CMake build, not the vendor's stripped artifact). The tarball's precompiled `.so`
     was never the thing that actually ships in this build. A **release** build (optimized,
     strippable) may narrow or reverse this gap — not measured here, don't assume either direction
     without measuring it directly. Full writeup: `forta.chat`'s `docs/plans/llama2/decisions.md`.
  3. **Smoke pass — clean.** `npm run cap:run` install/launch, no crash signal; multi-turn chat
     (2 real generations, 141 + 433 tokens) completed successfully end to end.
  4. **jinja `minja` bug — not reproduced.** `initContext`'s own model-info log line shows
     `chatTemplates={minja={default=true, ...}, llamaChat=true}` for the installed Qwen3-4B GGUF
     (populated, not `undefined` — the exact metadata whose absence caused the original
     "Cannot destructure property 'minja'" crash). No "Cannot destructure" line appeared across
     ~35k captured log lines spanning two full generations. Caveat: `RuntimeFacade` routes this model
     through mechanism 2 (`jinja:false`, caller-formatted prompt) directly — no mechanism-1 attempt
     was observed in the log at all, so the fallback-retry path itself was never exercised; the
     populated `chatTemplates.minja` is strong but not 100%-direct confirmation mechanism 1 wouldn't
     still throw for this exact model.
  5. **`n_predict = 50` substitution bug — not reproduced.** Both live generations stopped correctly
     at their natural EOS (`stopped_eos:true`, `has_next_token=false`) after 141 and 433 tokens
     respectively — neither cut off anywhere near 50. `RuntimeFacade`'s `DEFAULT_COMPLETION_MAX_TOKENS`
     choke point is kept regardless (per the original decision) — it structurally prevents this
     specific check from ever proving the *native* default is fixed, only that the app-level
     workaround continues to do its job.
- **New finding, not one of the original five:** prompt-eval (prefill) throughput does **not** show a
  clear win from context reuse even within the *same* warm in-memory context across consecutive turns
  — turn 1 evaluated 42 prompt tokens in 22.8 s (~1.84 tok/s), turn 2 evaluated a 226-token prompt
  (the full turn-1 exchange plus the new message) in 159.8 s (~1.41 tok/s) — slower per-token, not
  faster, consistent with plain per-token attention cost growing with context length rather than any
  cache being skipped. Generation throughput stayed flat around ~1.0–1.1 tok/s in both turns. These are
  now `forta.chat`'s perf-tuning-plan.md §9 baseline numbers.
- **Also confirmed this pass, not one of the original five:** no per-token streaming on Android at all
  (`docs/decisions.md`'s "No per-token streaming on Android" entry, 2026-08-20) — `onToken` never
  fires; the full reply renders at once when `completion()` resolves. This changes what "first-token
  latency" means for the whole perf-tuning plan: on Android today there is no visible progress until
  generation is entirely done, so total round-trip time (not time-to-first-token) is the number that
  actually matches what a user experiences.
- **Rollback:** trivial — both npm names remain published (`llama-cpp-capacitor`'s publishes are not
  being pulled per its own changelog), so reverting is `package.json` back to
  `llama-cpp-capacitor@^0.1.5` + reinstall + `cap sync`, no data migration involved.
- Resolves nothing in `docs/decisions.md` directly (no open question there names this); ADR 0001
  remains the authoritative API-shape reference — this ADR only supersedes the package name/version
  it was written against.
