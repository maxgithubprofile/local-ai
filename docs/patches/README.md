# `docs/patches/`

Drafted, third-party patches against `llama-cpp-pro` (a `node_modules` dependency, not part of
`local-ai`'s own source) that couldn't be built/verified from this environment — usually because the
target platform's toolchain isn't available here (no macOS/Xcode for iOS). Kept here instead of only
in chat history so the next person who has the right hardware doesn't have to reconstruct the fix from
scratch. See `docs/decisions.md` for the investigation each patch closes.

## `llama-cpp-pro+0.2.4-ios-token-streaming.patch`

Adds per-token streaming (`@LlamaCpp_onToken` events) to `llama-cpp-pro`'s iOS Capacitor plugin — the
iOS counterpart to the Android fix in `docs/decisions.md`'s "Android per-token streaming fixed"
entry. **Drafted 2026-08-20, source-read only — never compiled, linked, or run.** No Mac was available
to build the iOS xcframework or run a simulator/device. Every place a Mac needs to actually confirm
something is marked `TODO(mac)` inline in the patch — read those before trusting this in production.

**To apply**, in whichever project's `node_modules/llama-cpp-pro` you're building against (this
patch touches only `ios/Sources/LlamaCppCapacitor/*.swift`, no `local-ai` source):

```sh
patch -p1 -d node_modules/llama-cpp-pro < path/to/this/patch
# or, to make it survive `npm install` via patch-package (same convention
# docs/decisions.md's Android fix used in forta.chat):
cp path/to/this/patch patches/llama-cpp-pro+0.2.4.patch
```

If a `patches/llama-cpp-pro+0.2.4.patch` already exists (e.g. the Android fix), append this patch's
content to it rather than overwriting — `patch-package` applies one file's full contents as a single
unit.

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
