import { describe, expect, it } from 'vitest';
import { LifecycleManager } from '../../../src/core/runtime/lifecycle-manager.js';
import { FakeLlmRuntimeAdapter } from '../../../src/adapters/node-testing/fake-llm-runtime.adapter.js';
import { FakeAppLifecycleAdapter } from '../../../src/adapters/node-testing/fake-app-lifecycle.adapter.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';

describe('LifecycleManager', () => {
  it('releaseRuntime() releases both the model and embedding contexts', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    await runtime.loadModel();
    await runtime.loadEmbeddingModel();
    const sqlite = new NodeSqliteAdapter(':memory:');
    const manager = new LifecycleManager(runtime, sqlite);

    await manager.releaseRuntime();

    expect(runtime.modelLoaded).toBe(false);
    expect(runtime.embeddingModelLoaded).toBe(false);
  });

  it('releaseRuntime() is idempotent — calling it with nothing loaded does not throw', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const sqlite = new NodeSqliteAdapter(':memory:');
    const manager = new LifecycleManager(runtime, sqlite);

    await expect(manager.releaseRuntime()).resolves.toBeUndefined();
    await expect(manager.releaseRuntime()).resolves.toBeUndefined();
  });

  it('releaseRuntime({ closeDatabase: false }) (default) leaves the database usable', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();
    const manager = new LifecycleManager(runtime, sqlite);

    await manager.releaseRuntime();

    await expect(sqlite.query('SELECT 1')).resolves.toBeDefined();
  });

  it('releaseRuntime({ closeDatabase: true }) closes the database connection', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();
    const manager = new LifecycleManager(runtime, sqlite);

    await manager.releaseRuntime({ closeDatabase: true });

    await expect(sqlite.query('SELECT 1')).rejects.toBeDefined();
  });

  it('enableAutoUnloadOnBackground() calls the callback when the app backgrounds, not when it foregrounds', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const sqlite = new NodeSqliteAdapter(':memory:');
    const manager = new LifecycleManager(runtime, sqlite);
    const appLifecycle = new FakeAppLifecycleAdapter();

    let releaseCalls = 0;
    manager.enableAutoUnloadOnBackground(appLifecycle, async () => {
      releaseCalls += 1;
    });

    appLifecycle.setActive(true);
    expect(releaseCalls).toBe(0);
    appLifecycle.setActive(false);
    expect(releaseCalls).toBe(1);
  });

  it('disableAutoUnloadOnBackground() stops future callbacks', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const sqlite = new NodeSqliteAdapter(':memory:');
    const manager = new LifecycleManager(runtime, sqlite);
    const appLifecycle = new FakeAppLifecycleAdapter();

    let releaseCalls = 0;
    manager.enableAutoUnloadOnBackground(appLifecycle, async () => {
      releaseCalls += 1;
    });
    manager.disableAutoUnloadOnBackground();

    appLifecycle.setActive(false);
    expect(releaseCalls).toBe(0);
  });

  it('enableAutoUnloadOnBackground() called twice replaces the previous subscription rather than stacking', async () => {
    const runtime = new FakeLlmRuntimeAdapter();
    const sqlite = new NodeSqliteAdapter(':memory:');
    const manager = new LifecycleManager(runtime, sqlite);
    const appLifecycle = new FakeAppLifecycleAdapter();

    let calls = 0;
    manager.enableAutoUnloadOnBackground(appLifecycle, async () => {
      calls += 1;
    });
    manager.enableAutoUnloadOnBackground(appLifecycle, async () => {
      calls += 10;
    });

    appLifecycle.setActive(false);
    expect(calls).toBe(10); // only the second subscription fired, exactly once
  });
});
