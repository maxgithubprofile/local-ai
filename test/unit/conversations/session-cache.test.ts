import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionCache } from '../../../src/core/conversations/session-cache.js';
import { FakeLlmRuntimeAdapter } from '../../../src/adapters/node-testing/fake-llm-runtime.adapter.js';
import { NodeFsAdapter } from '../../../src/adapters/node-testing/node-fs.adapter.js';

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
