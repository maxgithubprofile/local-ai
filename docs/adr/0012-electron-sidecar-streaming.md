# 0012. `llama-cpp-pro` sidecar HTTP API capability mapping (Phase 0 spike ELEC.0.1b + 2 more findings)

Primarily resolves ELEC.0.1b (streaming); also documents two more gaps found in the same source
read-through (no tokenize endpoint, no session-persistence endpoint) that materially affect how
`LlamaCppProDesktopAdapter` should implement `countTokens()`/`saveSession()`/`loadSession()` — grouped
in one ADR since all three came from reading the same file (`cap-native-server.cpp`) to answer the
same underlying question: what does this HTTP API actually support.

**Status:** accepted — confirmed by reading `cap-native-server.cpp`'s actual request-handler source
directly (not `sidecar-client.cjs`'s convenience wrapper, and not assumed from the OpenAI API shape it
imitates), no live server needed to answer any of these three questions.
**Date:** 2026-08-29
**TZ section(s):** v6 §4.1, ledger rows #23, #25

## Context

ADR 0011 already confirmed `sidecar-client.cjs`'s own `chatCompletion()`/`completion()` helpers buffer
the full HTTP response (`res.on('data')` + `Buffer.concat` + one `JSON.parse`) and never parse SSE —
but that only proves the **JS convenience wrapper** doesn't stream, not that the sidecar's own HTTP
server can't. ELEC.0.1b asked to resolve that specific ambiguity by reading `cap-sidecar-main.cpp`'s
request handler directly, or a live streaming test against a running sidecar.

No working sidecar binary exists in this environment yet (ADR 0011), so a live test wasn't possible —
but the **request-handling logic itself lives in `cap-native-server.cpp`** (not
`cap-sidecar-main.cpp`, which is just the process entry point), and reading it directly answers the
question without needing to run it:

- `POST /v1/chat/completions`'s handler (`chat_handler`, line ~701) parses a real `stream` boolean out
  of the request JSON (`parse_openai_chat()`) and branches on it explicitly: `if (stream) {
  start_live_completion_stream(...); return; }` — a genuinely different code path from the
  non-streaming `run_prompt_completion()` call below it, not a shared implementation with `stream`
  silently ignored.
- `start_live_completion_stream()` → `llama_completion_stream()` (a real per-token callback API, not
  a post-hoc chunking of a complete response) → `sse_token_callback()` fires once per generated token,
  each time enqueuing a real Server-Sent Events line: `"data: " + json_chunk.dump() + "\n\n"`.
- The JSON chunk shape is a faithful OpenAI `chat.completion.chunk` object — `delta.content` per token,
  a leading `delta.role: "assistant"` chunk, a final chunk with `finish_reason: "stop"` and an empty
  `delta`, then a literal `data: [DONE]\n\n` sentinel line (`sse_finish_stream()`) — the exact same
  shape as OpenAI's own streaming API and every SSE-consuming client already expects.
- `attach_live_sse_provider()` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, and uses `httplib::Response::set_chunked_content_provider()` to actually
  flush each queued line to the socket as it's produced (a condition-variable-gated producer/consumer
  queue, not a buffer-then-send) — genuine incremental delivery at the HTTP layer, not just at the
  JSON-payload level.
- `POST /v1/completions` (the non-chat mechanism-2-style endpoint) has the identical `stream` branch
  and SSE machinery, confirmed at the same read (`completion_handler`, line ~792).

## Decision

Treat `llama-cpp-pro`'s sidecar as genuinely SSE-capable at the HTTP layer for both
`/v1/chat/completions` and `/v1/completions`. `LlamaCppProDesktopAdapter` (ELEC.1.1a, still blocked on
ADR 0011's build defect, unaffected by this finding) should implement its own SSE client — a plain
`fetch`/`http.request` reading the response body as a stream, splitting on `\n\n`, parsing each
`data: {...}` line, stopping on `data: [DONE]` — against `POST /v1/chat/completions` with
`stream: true`, **not** `sidecar-client.cjs`'s buffering wrapper, and **not** the documented
single-synthetic-chunk fallback ADR 0001 describes for cases with no real per-token delivery. That
fallback path is now confirmed unnecessary for Electron specifically — real per-token
`CompletionStream` delivery is achievable once ELEC.0.1 has a working binary to test the client
against.

## Also found while reading the same source: no HTTP tokenize endpoint exists

Not what ELEC.0.1b asked, but found in the same read-through and worth recording rather than
discovering later mid-implementation: `cap-native-server.cpp` registers no `/tokenize` or
`/v1/internal/tokenize` route at all (full route list confirmed via `grep -n 'svr\.\(Post\|Get\|Delete\)'`
across every `.cpp` file in the package: `/health`, `/v1/health`, `/v1/models`,
`/v1/internal/memory`, `/v1/internal/context-limit`, `/v1/internal/models/load`,
`DELETE /v1/internal/models/:id`, `/v1/chat/completions`, `/v1/completions`, `/v1/responses`,
`/v1/embeddings` — nothing else). The underlying C functions exist (`llama_cap_tokenize()`/
`llama_cap_detokenize()`, used internally by the streaming chunker) but aren't exposed over HTTP.
`sidecar-client.cjs` has no `tokenize()` method either, consistent with there being no route to call.

This matters because `LlmRuntimePort.countTokens()` is documented as **mandatory, real tokenization**
on every existing adapter (`docs/decisions.md` row #19, resolved via ADR 0001: "Both real runtime
adapters... implement `countTokens()` for real via the underlying plugin's own tokenizer — no
heuristic needed once a model is loaded"). The sidecar's HTTP API has no way to satisfy that for
Electron short of either (a) making a real, wasteful completion request just to read
`usage.prompt_tokens` back from the response, which spins up actual inference merely to count tokens
and defeats the purpose of a lightweight check `sendMessage()`'s context-window policy calls
per-message, or (b) falling back to the chars/4 heuristic — which ADR 0001/row #19 treats as a
temporary pre-model-load fallback everywhere else, not a permanent per-platform behavior.
**Decision, logged rather than silently assumed:** `LlamaCppProDesktopAdapter.countTokens()` should use
the chars/4 heuristic unconditionally on Electron until/unless `llama-cpp-pro` adds a real tokenize
endpoint — a deliberate, documented deviation from row #19's "no heuristic needed" claim for this one
platform specifically, not an oversight. Logged as a new open item in `docs/decisions.md` (ledger row
#25) rather than decided silently, since it's a real, user-visible accuracy tradeoff (heuristic token
counts feed `contextStrategy`'s truncation decisions, TZ §9.7) that the plugin's author may want to
close by adding a real endpoint rather than `local-ai` permanently working around its absence.

## Also found: no session/KV-cache persistence endpoint either

A third gap found in the same source read, checked because `LlmRuntimePort.saveSession()`/
`loadSession()` are non-optional methods (unlike `bench?()`): grepping `cap-llama.cpp`/
`cap-native-server.cpp`/`cap-llama.h` for `session`/`kv.*cache`/`state_save`/`state_load`/
`cache_prompt` finds only `kv_cache_type_from_str()` — KV-cache **quantization type** selection
(f16/q8_0/q4_0), unrelated to session persistence. There is no HTTP route or underlying C function for
saving/restoring a conversation's KV-cache state. Each `POST /v1/chat/completions` call reformats the
full `messages` array into a prompt and runs a fresh completion — nothing server-side resumes a prior
request's KV state across calls.

This means TZ §9.3's `SessionCache` — "second response in the same chat is measurably faster" via
warm KV-cache reuse, real and working on both mobile adapters (`saveSession`/`loadSession` map directly
to the native plugin's own session-file API there) — **cannot be implemented for real on Electron** with
the sidecar's current HTTP surface. Every message in a chat will reprocess the full prompt from scratch
server-side, regardless of what `local-ai`'s own `SessionCache` does. **Decision:**
`LlamaCppProDesktopAdapter.saveSession()` should be a no-op (resolves without writing anything) and
`loadSession()` should always throw — deliberately, not a bug — so `SessionCache.activate()`'s existing,
already-tested "corrupt/incompatible load → delete the bad file, fall back to cold-start" path handles
this automatically, reusing already-correct behavior rather than inventing a new "no session support"
code path elsewhere. This is a genuine performance-characteristic gap for Electron vs. mobile worth
flagging in user-facing docs (`docs/guides/electron-integration.md`), not silently absorbed.

## Also found: the streaming request body carries only `prompt`/`n_predict`/`temperature`

A fourth gap, same read-through: `start_live_completion_stream()`'s own internal request object
(`cap-native-server.cpp:559-562`) — the JSON actually handed to `llama_completion_stream()` — sets
exactly three fields: `prompt`, `n_predict` (from `max_tokens`), `temperature`. `parse_openai_chat()`/
`parse_openai_completion()` (the *inbound* HTTP request parsers) likewise only ever read `model`,
`messages`/`prompt`, `max_tokens`, `temperature`, `stream` from the request body — confirmed by
grepping the whole file for `top_p`/`top_k`/`seed`/`stop`, zero matches anywhere.

This means `CompletionOptions.topP`/`topK`/`seed`/`stop`/`repeatPenalty` — all real fields, all wired
through and tested on both existing adapters (`repeatPenalty` specifically was just fixed this same
session after being found dead on both `LlamaCppCapacitorAdapter`/`NodeLlamaCppAdapter`, see this file's
own earlier "`CompletionOptions.repeatPenalty` was dead" entry) — currently have **no path to the
sidecar's HTTP layer at all**. Sending any of them from `LlamaCppProDesktopAdapter` would silently do
nothing, the same class of bug the `repeatPenalty` fix just closed on the other two platforms, except
here the fix isn't possible client-side — it needs the sidecar's own C++ request parsing extended
first. `LlamaCppProDesktopAdapter` should either (a) implement the port faithfully and accept that
these options are silently ignored on Electron specifically until the sidecar exposes them — worth an
explicit doc-comment warning so it isn't mistaken for a bug later, mirroring how this fix's own
discovery happened — or (b) throw/warn when a caller passes one of these on Electron, trading silent
no-op for a loud "not supported here" signal. Not decided here (an implementation-detail product
choice for whoever writes ELEC.1.1a, not this spike's job) — logged as ledger row #27 rather than
picked silently.

## Also found: no server-side cancellation — abort is client-side-only

A fifth finding: no `/stop`/`/interrupt`/`/cancel` route exists (grepped for
`interrupt`/`/stop`/`cancel` across the server source, zero matches). The token-generation loop
(`start_live_completion_stream()`'s detached `std::thread`) doesn't check whether the HTTP client is
still connected before producing the next token — closing the client connection stops the *client*
from receiving further tokens, but the sidecar keeps generating server-side until it hits `n_predict`/
EOS on its own. **Decision:** `LlamaCppProDesktopAdapter`'s `AbortSignal` handling should still resolve
`CompletionResult.status: 'cancelled'` with whatever content accumulated client-side before the abort
(same contract every other adapter honors, TZ §9.8) — the difference is purely an internal resource-
waste concern (the sidecar burns CPU finishing a generation nobody reads), not a correctness gap for
`local-ai`'s own API surface. Worth a doc-comment on the adapter noting this, since a future contributor
might otherwise assume aborting the HTTP request also stops the sidecar's work, the way
`stopCompletion()` genuinely does on both mobile adapters.

## Consequences

- Resolves ledger row #23 as `Resolved`, no longer `Open`.
- **Corrects** every prior mention in this ROADMAP/TZ of ELEC.1.1a "depends on ELEC.0.1b" as an open
  *unknown* — it was answered by this ADR; ELEC.1.1a's remaining, sole blocker is ADR 0011's build
  defect, not any protocol-level uncertainty.
- Not yet verified end-to-end against a live server (no working binary) — the JSON chunk shapes and
  `Content-Type`/streaming-provider mechanics are read directly from source, which is strong evidence
  but not the same as observing real bytes on a real socket. Re-confirm with a live
  `curl -N .../v1/chat/completions -d '{"stream":true,...}'` test the moment ADR 0011 unblocks and a
  binary exists to point at.
- This is real, load-bearing design information for whoever writes `LlamaCppProDesktopAdapter` next —
  the SSE parsing logic can be written and unit-tested against a fake HTTP stream today, independent of
  ADR 0011's build blocker, if that's ever useful to pull forward before a real binary exists.
