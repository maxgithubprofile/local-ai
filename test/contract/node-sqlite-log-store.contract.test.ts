import { NodeSqliteAdapter } from '../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../src/core/db/database.js';
import { defineLogStoreContract } from './log-store.contract.js';

defineLogStoreContract(async () => {
  const sqlite = new NodeSqliteAdapter(':memory:');
  const clock = new FakeClockAdapter();
  await new Database(sqlite, clock).migrate();
  return { sqlite, clock };
});
