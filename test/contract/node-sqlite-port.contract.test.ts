import { NodeSqliteAdapter } from '../../src/adapters/node-testing/node-sqlite.adapter.js';
import { defineSqlitePortContract } from './sqlite-port.contract.js';

defineSqlitePortContract(async () => ({ sqlite: new NodeSqliteAdapter(':memory:') }));
