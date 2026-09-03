# `docs/patches/`

**Superseded 2026-09-03 by a real fork** — see "Fork, not patch-package" below. This directory's patch
files are kept for historical/audit context (what changed and why) but are no longer the recommended
way to get these fixes into a consuming app.

## Fork, not patch-package

`local-ai`'s consumers no longer need `patch-package` for `llama-cpp-pro`. The accumulated fixes
(Android per-token streaming + `contextId` routing, the UTF-8 streaming-safety fix, and the iOS
per-token streaming patch below) are committed as real source in
**[`github.com/maxgithubprofile/llama-cpp-pro`](https://github.com/maxgithubprofile/llama-cpp-pro)**,
tag `v0.2.4-local-ai.1`, a fork of upstream `arusatech/llama-cpp-pro` (MIT-licensed).

**Why the switch:** `patch-package` proved fragile for a dependency with this much native-code drift.
The same session that produced the iOS patch below also found that forta.chat's tracked
`patches/llama-cpp-pro+0.2.4.patch` had gone stale relative to what was actually running — someone had
hand-edited a fix (an added `contextId` parameter on `completionNative()`) directly into
`node_modules` and never regenerated the patch file, meaning a genuinely fresh install elsewhere would
have silently lost that fix. A fork removes the whole "patch file vs. live tree" drift class: the
patched code just *is* the repository. It's also the one place every consumer of `local-ai`'s
`llama-cpp-pro` peer dependency can point at, instead of each consuming app maintaining its own
`patch-package` setup independently (which is exactly how the drift above went unnoticed as long as it
did).

**What the fork's `main` branch is, concretely:** not a simple layer on top of upstream's `main` —
upstream's `main` had already moved on to a restructured native-source layout (`cpp/` → `native/` +
a `third_party/llama.cpp` git submodule) that doesn't match what's actually published to npm as
`0.2.4`. The fork's history instead starts from a `vendor: reset to published npm
llama-cpp-pro@0.2.4 content` commit — verified byte-identical (`sha512-CPGajT...`) to the registry
tarball — with the fixes applied as a second commit on top. Syncing with upstream in the future will
need deliberate re-porting against upstream's new `native/` layout, not a plain `git merge`; that was
already true before the fork existed, since patch-package's patches were equally incompatible with
upstream's restructured `main`.

**For a consuming app:** point the dependency at the fork instead of the registry —

```json
"llama-cpp-pro": "github:maxgithubprofile/llama-cpp-pro#v0.2.4-local-ai.1"
```

— and drop any `patches/llama-cpp-pro+0.2.4.patch` / `patch-package` postinstall step for this package
entirely (re-applying it on top of the fork's already-fixed source would just fail).

---

The rest of this file documents the individual patches as originally drafted, for context on what
each one does and why — useful if you're porting a fix to a newer `llama-cpp-pro` version, less useful
as literal apply instructions now that the fork exists. See `docs/decisions.md` for the investigation
each patch closes.

## `llama-cpp-pro+0.2.4-ios-token-streaming.patch`

Adds per-token streaming (`@LlamaCpp_onToken` events) to `llama-cpp-pro`'s iOS Capacitor plugin — the
iOS counterpart to the Android fix in `docs/decisions.md`'s "Android per-token streaming fixed"
entry. **Drafted 2026-08-20, source-read only — never compiled, linked, or run.** No Mac was available
to build the iOS xcframework or run a simulator/device. Every place a Mac needs to actually confirm
something is marked `TODO(mac)` inline in the patch — read those before trusting this in production.

**Status (2026-09-03): merged into forta.chat's build via a regenerated patch file, still unverified on
a device.** Rebased onto `node_modules/llama-cpp-pro/...` paths, applied for real to forta.chat's
`node_modules/llama-cpp-pro`, then `forta.chat/patches/llama-cpp-pro+0.2.4.patch` was **regenerated
from that live tree** (`npx patch-package llama-cpp-pro`, after clearing 513MB of stale
`android/{build,.cxx}` Gradle cache that was blocking the auto-diff's internal `git add` on Windows —
see `docs/decisions.md`'s matching 2026-09-03 entry for the full story) rather than hand-appended, so
it's diffed directly against a real pristine copy instead of pasted in.

That regeneration also caught a real, independent bug worth knowing about: forta.chat's **live**
`node_modules/llama-cpp-pro` had a `completionNative()` call site fix (an added `contextId` parameter,
almost certainly needed to route streamed tokens to the right JS-side context on Android) that had
been hand-edited directly into `node_modules` at some point and **never captured back into the tracked
patch file** — a real, silent regression risk on any fresh install elsewhere. The regeneration fixed
that too, as a side effect of diffing the actual live tree instead of trusting the old patch file.

**Validated for real** (delete `node_modules/llama-cpp-pro` → fresh `npm install llama-cpp-pro@0.2.4
--ignore-scripts` → plain `npx patch-package`, the same command `postinstall` runs) — applied cleanly,
all fixes' markers present afterward. This exercises `patch-package`'s own apply mechanism, the one
that actually runs in production, not just a text-level dry-run.

None of this compiles Swift, builds the xcframework, or exercises the `TODO(mac)` runtime concerns
(missing-symbol fallback, main-thread `notifyListeners` safety, `reasoning_content`/stop-word
bookkeeping on the streaming path) — **this is still "textually correct and reproducibly installable,
behavior unconfirmed."** Someone with a Mac still needs to do the four steps below before an iOS
release ships this. If that verification finds a bug: edit the file under
`node_modules/llama-cpp-pro/ios/Sources/LlamaCppCapacitor/` directly, then re-run
`npx patch-package llama-cpp-pro` to regenerate the tracked patch from that edit — **do not** hand-edit
the `.patch` file's text, and do not leave a `node_modules` edit uncaptured the way the `contextId` fix
above did.

**To apply** (in a project that doesn't already have the Android/UTF-8 hunks), in whichever project's
`node_modules/llama-cpp-pro` you're building against (this patch touches only
`ios/Sources/LlamaCppCapacitor/*.swift`, no `local-ai` source):

```sh
patch -p1 -d node_modules/llama-cpp-pro < path/to/this/patch
# or, to make it survive `npm install` via patch-package (same convention
# docs/decisions.md's Android fix used in forta.chat):
cp path/to/this/patch patches/llama-cpp-pro+0.2.4.patch
```

If a `patches/llama-cpp-pro+0.2.4.patch` already exists (e.g. the Android fix — this is forta.chat's
situation as of 2026-09-03, see "Status" above), append this patch's content to it rather than
overwriting — `patch-package` applies one file's full contents as a single unit.

**After applying, on the Mac:**
1. Rebuild the iOS xcframework (`bash node_modules/llama-cpp-pro/scripts/ensure-llama-ios-xcframework.sh`
   — may need `rm -rf node_modules/llama-cpp-pro/ios/Frameworks/llama-cpp.xcframework` first if the
   script's cache check short-circuits; see `TODO(mac)` point 1 in `LlamaNativeBridge.swift`'s
   `runCompletionStream()`).
2. Build and run the consuming app on a real device (a simulator may not exercise the same
   Metal/threading paths).
3. Watch for `@LlamaCpp_onToken` events actually arriving in the JS layer, the same way
   `docs/decisions.md`'s Android entry verified via `adb logcat` — Xcode's device console is the iOS
   equivalent.
4. Work through every inline `TODO(mac)` in the three patched files before considering this done, not
   just "it compiled."
