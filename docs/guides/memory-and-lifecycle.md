# Memory and lifecycle

## `releaseRuntime()`

```ts
await client.releaseRuntime(); // or the deprecated alias client.unloadAll()
```

Releases the LLM and embedding native contexts (independently — if you only ever loaded one, only
that one is released) and resets `local-ai`'s own in-memory caches (the parsed manifest, the
session-cache's "which chat is hot" pointer). Idempotent — call it as many times as you like.

**What it does not touch, deliberately** (TZ §11.1): model/embedding files on disk, chats and
messages in SQL, `download_state`/in-progress downloads, session-cache **files** (only the in-memory
handle to one is dropped — the file itself is exactly as valid as before, and the next
`sendMessage()` in that chat will happily load it again once the runtime is back up). Pass
`{ closeDatabase: true }` if you also want the SQLite connection closed — off by default.

```ts
await client.releaseRuntime({ closeDatabase: true });
```

The next call to `complete()`/`sendMessage()`/`ensureModelReady()`/etc. lazily re-establishes
whatever's needed — there's no separate "wake up" step required.

## `autoUnloadOnBackground`

```ts
const client = await LocalAiClient.create({ manifestUrl, ports, autoUnloadOnBackground: true });
```

Off by default (TZ §11.2) — a memory-vs-latency tradeoff the consumer app should make deliberately.
When on, `local-ai` releases the runtime automatically whenever `@capacitor/app` reports the app
going to the background, and — importantly — does **not** eagerly reload when the app comes back to
the foreground. The next real use lazily re-establishes the context, same as a manual
`releaseRuntime()`.

If the app backgrounds while a `complete()`/`sendMessage()` generation is still in flight, the
release is **deferred** until that generation settles (`RuntimeFacade.waitUntilIdle()`) rather than
tearing the native context down mid-stream — backgrounding never truncates/kills a reply already in
progress. This only protects generation itself from the JS side; a consumer app whose process can be
suspended/killed by the OS while backgrounded still needs its own platform-level mechanism (e.g. an
Android foreground service) to keep the process alive long enough for that deferred release to ever
run.

## `reload()`

```ts
await client.reload(); // ensureModelReady() + ensureEmbeddingReady(), using whatever's already downloaded
```

An explicit "pay the reload latency now instead of on the next message" call, for a consumer that
wants to eagerly warm the runtime back up right after backgrounding/release rather than let the next
`sendMessage()` pay for it. Never re-downloads anything that's already on disk and verified.

## What "released" actually means

`use_mlock: false` by default means the OS may keep the model's pages in its page cache even after
`releaseRuntime()` — the library guarantees it no longer holds any reference/handle to the native
context, **not** that the OS instantly reclaims that memory (TZ §11.3). If you're profiling memory and
see it not drop to zero immediately after a release, this is expected, not a leak in `local-ai`.

## `destroy()`

```ts
await client.destroy();
```

Full teardown for when you're completely done with a `LocalAiClient` instance: releases the runtime,
closes the database, stops listening for app-lifecycle transitions, and clears every registered event
handler. Not part of TZ §11's release-boundary table — this is a separate, stronger "I'm discarding
this instance" method, not something you'd normally call as part of a background/foreground cycle.
