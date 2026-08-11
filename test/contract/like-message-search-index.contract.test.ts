import { LikeMessageSearchIndex } from '../../src/core/db/like-message-search-index.js';
import { NodeSqliteAdapter } from '../../src/adapters/node-testing/node-sqlite.adapter.js';
import { FakeClockAdapter } from '../../src/adapters/node-testing/fake-clock.adapter.js';
import { Database } from '../../src/core/db/database.js';
import { defineMessageSearchIndexContract } from './message-search-index.contract.js';

defineMessageSearchIndexContract(async () => {
  const sqlite = new NodeSqliteAdapter(':memory:');
  await new Database(sqlite, new FakeClockAdapter()).migrate();
  return { sqlite, index: new LikeMessageSearchIndex(sqlite) };
});
