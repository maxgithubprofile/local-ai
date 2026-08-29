# 0011. `llama-cpp-pro` desktop sidecar build/packaging (Phase 0 spike ELEC.0.1)

**Status:** accepted — a working sidecar binary was actually built, started, and exercised end-to-end
against a real GGUF model in this environment (real HTTP requests, real streamed tokens, real
embeddings, not mocked). Scoped narrowly: Windows x64, `cpu` variant, this environment's MSVC 19.28
(VS2019 16.8-ish) toolset. Other variants/backends/OSes not verified — see Consequences.
**Date:** 2026-08-29 (superseded within the same day — see "Resolution" below; the investigation
narrative that follows is kept because it's what a future upstream bug report or CI recipe should be
built from)
**TZ section(s):** v6 §4.1, ledger row #24

## Context

`ROADMAP.md`'s ELEC.0.1 asked to confirm the plugin's own `build-variants.sh --variant desktop` /
`sidecar/CMakeLists.txt` actually produces a working sidecar binary, starting with the CPU-only
`vulkan-openblas`/`cpu` fallback per the task's own stated priority. **This spike actually ran the
build**, not just read the recipe — `llama-cpp-pro@0.2.4`'s vendored C++ sources are genuinely shipped
in the installed npm package (`node_modules/llama-cpp-pro/cpp/`, 161 files, confirmed present, not a
git-submodule reference that would be missing from a plain `npm install`).

Toolchain available in this environment: CMake 4.4.2, Visual Studio 2019 Community (MSVC 19.28.29910,
a mid-2019-era 16.8-ish toolset — no `/std:c++20` flag support, only `/std:c++latest`), LLVM/clang
22.1.8 (`clang.exe`/`clang-cl.exe` present, but VS2019's ClangCL MSBuild toolset integration component
is **not** installed, and no Ninja generator is available either — a clang-cl cross-check was
attempted and blocked by tooling, not source). No macOS/Linux machine available (same residual-risk
shape as every other Phase 0 spike in this ROADMAP).

### What was actually run, in order

1. `cmake -B build -S sidecar -DSIDECAR_VARIANT=cpu -G "Visual Studio 16 2019" -A x64` — **configure
   succeeds**, no missing-dependency errors (the `cpu` variant needs no Vulkan/CUDA SDK).
2. `cmake --build build --config Release` at the CMakeLists.txt-declared `CMAKE_CXX_STANDARD 17` —
   **fails with 3 independent, real compile errors**, none related to GPU/hardware:
   - `cap-llama.cpp:64` — `va_start`/`va_end` unresolved (`error C3861`) — missing `#include <cstdarg>`;
     GCC/Clang's headers pull this in transitively, MSVC's STL doesn't.
   - `cap-llama.cpp:264,275` — `error C7555: для использования инициализаторов агрегатов требуется
     параметр /std:c++latest` — the code uses C++20 designated initializers; GCC/Clang accept this
     under C++17 as a non-standard extension, MSVC does not.
   - `cap-tts.cpp:312,317` — `error C2065: M_PI: идентификатор не найден` — MSVC only exposes `M_PI`
     from `<cmath>` when `_USE_MATH_DEFINES` is defined **before the first transitive include of
     `<cmath>`/`<math.h>` anywhere in the translation unit**.
3. Bumped `CMAKE_CXX_STANDARD` to `20` and added the two missing fixes for #1/#3 as local `.cpp`-file
   edits — designated-initializer/`va_start` errors gone, but a **new** error appeared in
   `llama-chat.cpp` (5 call sites): `error C2280`/`C2088` — `std::operator<<(ostream&, const char8_t*)`
   deleted/ambiguous. C++20 makes `char8_t` distinct from `char`; the file streams a `u8"..."` literal
   through `<<` in a way that only compiles when `char8_t` isn't distinct (C++17, or MSVC's
   `/Zc:char8_t-`).
4. Standalone-compiled just `llama-chat.cpp` with `cl /std:c++latest /Zc:char8_t- /EHsc` — compiles
   cleanly, confirming the flag as a real per-file fix.
5. Added `/Zc:char8_t-` **globally** via `target_compile_options()` — surfaced a **different** error:
   vendored `nlohmann/json.hpp` (used by the Jinja chat-template engine) needs `char8_t` *enabled*
   (`std::u8string`/`char8_t` referenced as real identifiers) — the inverse of step 3/4's fix. A global
   flag can't satisfy both files at once.
6. clang-cl cross-check attempted — blocked by environment (VS2019's ClangCL component and Ninja both
   absent here), not source. Not completed, left as a residual gap.

### Resolution — the actual fix, verified end-to-end

Step 5's "genuine conflict" was real but **not unresolvable** — the fix is scoping `/Zc:char8_t-` to
*only* `llama-chat.cpp`'s compilation unit via CMake's `set_source_files_properties(...)
PROPERTIES COMPILE_OPTIONS "/Zc:char8_t-")`, leaving every other file (including `nlohmann/json.hpp`'s
translation units) compiled with `char8_t` enabled as C++20 normally has it. Combined with:
- `CMAKE_CXX_STANDARD 20` (satisfies the designated initializers),
- `#include <cstdarg>` added to `cap-llama.cpp` (satisfies `va_start`/`va_end`),
- `-D_USE_MATH_DEFINES` added **globally** to `SIDECAR_COMPILE_DEFS`, not as a per-file `#define`
  (the per-file version failed — same include-order fragility flagged in step 2's third bullet; the
  global compile-definition form guarantees it's set before any translation unit's first `<cmath>`
  include, wherever that happens to be) —

a full clean build **succeeded**: `win32-x64-cpu.exe`, 5.1MB, linked with zero errors. This binary was
then:
- **Started** for real (`win32-x64-cpu.exe --host 127.0.0.1 --port 18099 --no-gpu`) — `GET /health`
  returned `{"status":"ok",...}`.
- **Loaded a real model** — `test/fixtures/stories260K.gguf` (the same small real GGUF fixture
  `NodeLlamaCppAdapter`'s own integration tests use, TZ §13.1) via `POST /v1/internal/models/load` —
  succeeded.
- **Streamed real tokens** — `POST /v1/chat/completions` with `stream: true` returned genuine
  incremental SSE (`data: {"choices":[{"delta":{"content":"W"}}]}`, then `"he"`, `"re"`, ... — real,
  distinct model-generated tokens, not a canned response), ending with a `finish_reason: "stop"` chunk
  and `data: [DONE]` — exactly matching ADR 0012's source-reading prediction, now confirmed by actually
  watching bytes arrive on a socket.
- **Produced real embeddings** — `POST /v1/embeddings` returned a real float vector.
- **Unloaded cleanly** — `DELETE /v1/internal/models/stories260k` succeeded, `GET /v1/models`
  afterward showed zero loaded models.

All test builds/patches were made in `node_modules/llama-cpp-pro` (npm-installed, gitignored,
disposable) — nothing in this repo's own tracked source was changed by the experiments themselves; the
working `CMakeLists.txt` diff (4 small, precisely-scoped changes) is captured above for whoever files
the upstream report or writes a CI recipe.

## Decision

1. **Report the underlying defects to `llama-cpp-pro`'s maintainer anyway**, even though a workaround
   exists — `cap-llama.cpp`'s missing `<cstdarg>` include and C++20 requirement, `cap-tts.cpp`'s missing
   `_USE_MATH_DEFINES`, and `llama-chat.cpp`'s `char8_t`/ostream issue are real portability defects a
   stock MSVC toolchain hits without any workaround; `local-ai` having found a working recipe doesn't
   mean every consumer building this package should have to rediscover it.
2. **Do not vendor these patches into `local-ai`'s own tree as a permanent local fix.** The verified
   recipe (4 CMakeLists.txt-level changes, no source-file edits needed except the `<cstdarg>` include)
   is small enough that `ROADMAP.md`'s ELEC.1.1a task can carry it as documented guidance for whoever
   scripts the actual build step (CI, or a `postinstall`-style staging script) — but it should be
   applied at build time against whatever `llama-cpp-pro` version is actually installed, not hard-coded
   as a patched copy that drifts from upstream releases.
3. **ELEC.1.1a (`LlamaCppProDesktopAdapter`) is now unblocked** — a working binary exists and was
   confirmed end-to-end. See `ROADMAP.md`'s Phase 1 for the adapter itself.
4. **ELEC.2.2's CI matrix** can now plausibly build the sidecar on `windows-latest`, but this hasn't
   been tried on a real CI runner (only this dev environment) — `windows-latest` ships a newer MSVC
   (VS2022) which may or may not need the exact same 4 fixes; verify there before assuming this recipe
   transfers unchanged.

## Consequences

- **Corrects** this ADR's own same-day earlier finding — the "genuine, unresolvable conflict" between
  `llama-chat.cpp` and `nlohmann/json.hpp` was real but *was* resolvable, via per-translation-unit flag
  scoping rather than a global flag. Worth remembering as a lesson for the next MSVC/`char8_t`-shaped
  conflict: a global compiler flag being wrong for one file doesn't mean the flag is wrong everywhere.
- Unblocks ELEC.1.1a, ELEC.1.2's `isPluginAvailable('LlamaCpp')` real-binary check, and ELEC.2.2's CI
  matrix's sidecar-build step (though the last one is still unverified on actual CI infrastructure).
- **Still unverified**: GPU variants (`vulkan`, `vulkan-openblas`, `cuda`, `metal`, `metal-coreml`,
  `rocm`) — only the CPU-only `cpu` variant was built and tested; `vulkan-openblas` is the packaged
  default on Windows/Linux per `CMakeLists.txt` and needs the Vulkan SDK, not attempted here. macOS/
  Linux builds — untested, no such machine available; `char8_t`/`M_PI`/`va_start` are MSVC-specific
  gotchas GCC/Clang likely don't hit at all, so those platforms may build cleanly with zero of these
  fixes, or may have entirely different issues — genuinely unknown, not assumed either way.
- `ELEC.0.1a` (packaged-app `loadExtension()` test) and the Vulkan/CUDA/Metal variants remain open
  follow-ups, now unblocked in the sense that a real Electron app packaging story could be attempted
  next, not still stuck on "does anything build at all."
