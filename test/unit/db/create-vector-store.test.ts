import { describe, expect, it } from 'vitest';
import { createVectorStore } from '../../../src/core/db/create-vector-store.js';
import { BruteForceVectorStore } from '../../../src/core/db/brute-force-vector-store.js';
import { NodeSqliteAdapter } from '../../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../../src/core/db/database.js';

describe('createVectorStore()', () => {
  it('falls back to BruteForceVectorStore when loadVectorExtension() resolves false (NodeSqliteAdapter, TZ §8.3)', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();

    const { store, usedFallback } = await createVectorStore(sqlite, new FakeClockAdapter());

    expect(usedFallback).toBe(true);
    expect(store).toBeInstanceOf(BruteForceVectorStore);
  });

  it('the fallback store is immediately usable', async () => {
    const sqlite = new NodeSqliteAdapter(':memory:');
    await new Database(sqlite, new FakeClockAdapter()).migrate();
    const { store } = await createVectorStore(sqlite, new FakeClockAdapter());

    const space = { embeddingId: 'e', embeddingVersion: 1, dimensions: 2 };
    await store.ensureSchema(space);
    await store.upsert({ id: 'a', embedding: new Float32Array([1, 0]) }, space);
    expect(await store.count()).toBe(1);
  });
});
