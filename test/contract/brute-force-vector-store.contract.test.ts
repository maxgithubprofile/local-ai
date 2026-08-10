import { BruteForceVectorStore } from '../../src/core/db/brute-force-vector-store.js';
import { NodeSqliteAdapter } from '../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../src/core/db/database.js';
import { defineVectorStoreContract } from './vector-store.contract.js';

defineVectorStoreContract(async () => {
  const sqlite = new NodeSqliteAdapter(':memory:');
  await new Database(sqlite, new FakeClockAdapter()).migrate();
  return new BruteForceVectorStore(sqlite, new FakeClockAdapter());
});
