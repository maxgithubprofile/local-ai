import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionCache } from '../../../src/core/conversations/session-cache.js';
import { FakeLlmRuntimeAdapter } from '../../../src/adapters/node-testing/fake-llm-runtime.adapter.js';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';
import type { FileSystemPort } from '../../../src/core/ports/filesystem.port.js';

describe('SessionCache', () => {
  let tmpDir: string;
  let runtime: FakeLlmRuntimeAdapter;
  let fileSystem: NodeFsAdapter;
  let cache: SessionCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ai-session-cache-'));
    runtime = new FakeLlmRuntimeAdapter();
    fileSystem = new NodeFsAdapter(tmpDir);
    cache = new SessionCache(runtime, fileSystem);
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('activate() on a chat with no prior session reports loadedFromCache: false (cold start)', async () => {
    const result = await cache.activate('chat-1', 'model-v1');
    expect(result.loadedFromCache).toBe(false);
    expect(cache.activeChat).toBe('chat-1');
    expect(runtime.loadedSessionPaths).toHaveLength(0);
  });

  it('save() then activate() the same chat again reports loadedFromCache: true', async () => {
    await cache.activate('chat-1', 'model-v1');
    await cache.save('chat-1', 'model-v1');

    const fresh = new SessionCache(runtime, fileSystem); // simulate a new app session
    const result = await fresh.activate('chat-1', 'model-v1');

    expect(result.loadedFromCache).toBe(true);
    expect(runtime.loadedSessionPaths).toHaveLength(1);
  });

  it('a different modelFingerprint for the same chat is treated as no session (fingerprint embedded in filename)', async () => {
    await cache.activate('chat-1', 'model-v1');
    await cache.save('chat-1', 'model-v1');

    const result = await cache.activate('chat-1', 'model-v2');
    expect(result.loadedFromCache).toBe(false);
  });

  it('a corrupt/incompatible session file falls back to cold start and deletes the bad file', async () => {
    await cache.activate('chat-1', 'model-v1');
    await cache.save('chat-1', 'model-v1');
    const sessionPath = fileSystem.resolvePath('sessions', 'session-chat-1-model-v1.bin');
    expect(await fileSystem.exists(sessionPath)).toBe(true);

    runtime.shouldFailLoadSession = true;
    const fresh = new SessionCache(runtime, fileSystem);
    const result = await fresh.activate('chat-1', 'model-v1');

    expect(result.loadedFromCache).toBe(false);
    expect(await fileSystem.exists(sessionPath)).toBe(false);
  });

  it('re-activating the already-hot chat+fingerprint is a no-op (no redundant loadSession call)', async () => {
    await cache.activate('chat-1', 'model-v1');
    await cache.save('chat-1', 'model-v1');
    await cache.activate('chat-1', 'model-v1'); // still hot from the first activate — no file existed yet, but pointer already matches
    expect(runtime.loadedSessionPaths).toHaveLength(0);
  });

  it('invalidateAll() removes every session file and clears the hot pointer', async () => {
    await cache.activate('chat-1', 'model-v1');
    await cache.save('chat-1', 'model-v1');

    await cache.invalidateAll();

    expect(cache.activeChat).toBeNull();
    const fresh = new SessionCache(runtime, fileSystem);
    expect((await fresh.activate('chat-1', 'model-v1')).loadedFromCache).toBe(false);
  });

  it('exposes the configured slot count, defaulting to 3', async () => {
    expect(cache.slotCount).toBe(3);
    const custom = new SessionCache(runtime, fileSystem, { maxSlots: 5 });
    expect(custom.slotCount).toBe(5);
  });

  it('evicts the least-recently-used session file once maxSlots is exceeded (Phase 8 LRU)', async () => {
    const lru = new SessionCache(runtime, fileSystem, { maxSlots: 2 });

    await lru.activate('chat-1', 'model-v1');
    await lru.save('chat-1', 'model-v1');
    await lru.activate('chat-2', 'model-v1');
    await lru.save('chat-2', 'model-v1');
    await lru.activate('chat-3', 'model-v1'); // pushes the LRU set to 3 slots -> evicts chat-1 (oldest)
    await lru.save('chat-3', 'model-v1');

    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-1-model-v1.bin'))).toBe(false);
    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-2-model-v1.bin'))).toBe(true);
    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-3-model-v1.bin'))).toBe(true);
  });

  it('re-activating a chat bumps it to most-recently-used, saving it from eviction', async () => {
    const lru = new SessionCache(runtime, fileSystem, { maxSlots: 2 });

    await lru.activate('chat-1', 'model-v1');
    await lru.save('chat-1', 'model-v1');
    await lru.activate('chat-2', 'model-v1');
    await lru.save('chat-2', 'model-v1'); // slots: [chat-1, chat-2], both under the cap

    await lru.activate('chat-1', 'model-v1'); // re-load chat-1 -> bumps it to most-recent: [chat-2, chat-1]
    await lru.activate('chat-3', 'model-v1');
    await lru.save('chat-3', 'model-v1'); // pushes to 3 slots -> evicts the now-oldest, chat-2

    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-1-model-v1.bin'))).toBe(true);
    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-2-model-v1.bin'))).toBe(false);
    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-3-model-v1.bin'))).toBe(true);
  });

  // Regression for the 2026-08-19 live bug: loadSession()/saveSession() were
  // being handed the port's own relative+directory-convention path
  // directly — fine for fileSystem.exists()/deleteFile() (same port, same
  // convention) but meaningless to the native runtime behind
  // LlmRuntimePort, which has no concept of it. This wraps toAbsolutePath()
  // to return an observably different (but still valid, on-disk) path, and
  // asserts SessionCache forwards *that* to the runtime while still using
  // the original path for its own fileSystem.*() calls.
  it('activate()/save() pass loadSession()/saveSession() the fileSystem.toAbsolutePath()-resolved path, not the raw one', async () => {
    const rawPathsSeen: string[] = [];
    const wrappedFs: FileSystemPort = {
      exists: (p) => fileSystem.exists(p),
      mkdir: (p, o) => fileSystem.mkdir(p, o),
      writeFile: (p, d) => fileSystem.writeFile(p, d),
      appendFile: (p, d) => fileSystem.appendFile(p, d),
      readFile: (p) => fileSystem.readFile(p),
      readChunks: (p, c) => fileSystem.readChunks(p, c),
      deleteFile: (p) => fileSystem.deleteFile(p),
      listFiles: (p) => fileSystem.listFiles(p),
      stat: (p) => fileSystem.stat(p),
      resolvePath: (...s) => fileSystem.resolvePath(...s),
      freeSpaceBytes: (p) => fileSystem.freeSpaceBytes(p),
      toAbsolutePath: async (p) => {
        rawPathsSeen.push(p);
        const real = await fileSystem.toAbsolutePath(p);
        // Filename-level marker, not a new directory level — SessionCache's
        // own mkdir() (session-cache.ts) creates the *port's* "sessions"
        // dir, which a real toAbsolutePath() (rename/decode only, see
        // CapacitorFsAdapter's own doc comment) never disagrees with; a
        // fake that invented an extra directory here would need its own
        // mkdir too, which isn't what this test is checking.
        return path.join(path.dirname(real), `resolved-marker-${path.basename(real)}`);
      },
    };
    const wrapped = new SessionCache(runtime, wrappedFs);
    const expectedRelative = fileSystem.resolvePath('sessions', 'session-chat-1-model-v1.bin');

    await wrapped.save('chat-1', 'model-v1');
    expect(rawPathsSeen).toContain(expectedRelative); // toAbsolutePath() itself got the plain (pre-resolution) path
    expect(runtime.savedSessionPaths).toHaveLength(1);
    expect(runtime.savedSessionPaths[0]).toContain('resolved-marker');
    expect(runtime.savedSessionPaths[0]).not.toBe(expectedRelative);

    // Write the session file directly at the real (untransformed) location
    // — exists()/deleteFile() must keep using that convention, independent
    // of toAbsolutePath()'s output — so activate() finds it and proceeds to
    // loadSession().
    await fileSystem.writeFile(expectedRelative, 'fake-session-marker');
    const fresh = new SessionCache(runtime, wrappedFs);
    const result = await fresh.activate('chat-1', 'model-v1');

    expect(result.loadedFromCache).toBe(true);
    expect(runtime.loadedSessionPaths).toHaveLength(1);
    expect(runtime.loadedSessionPaths[0]).toContain('resolved-marker');
  });

  it('deleteForChat() removes only that chat\'s session file(s)', async () => {
    await cache.activate('chat-1', 'model-v1');
    await cache.save('chat-1', 'model-v1');
    const other = new SessionCache(runtime, fileSystem);
    await other.activate('chat-2', 'model-v1');
    await other.save('chat-2', 'model-v1');

    await cache.deleteForChat('chat-1');

    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-1-model-v1.bin'))).toBe(false);
    expect(await fileSystem.exists(fileSystem.resolvePath('sessions', 'session-chat-2-model-v1.bin'))).toBe(true);
    expect(cache.activeChat).toBeNull();
  });
});
