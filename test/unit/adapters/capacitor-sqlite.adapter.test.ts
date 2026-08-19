import { describe, expect, it, vi } from 'vitest';

/**
 * Regression for a real on-device bug (forta.chat AI-chat migration runner,
 * 2026-08-19): `@capacitor-community/sqlite`'s `execute()`/`run()` default
 * their own `transaction` param to `true` — calling them unmodified from
 * inside `CapacitorSqliteAdapter.transaction()` (which already opened one
 * via `beginTransaction()`) makes the native plugin try to nest a second
 * transaction on the same connection and throw "Already in transaction".
 * Never caught by `NodeSqliteAdapter`/contract tests — neither
 * `better-sqlite3` nor `node:sqlite` auto-wraps every call in its own
 * transaction, so this is specific to the real Capacitor bridge. Mocks the
 * plugin surface rather than needing a device, since the bug is entirely in
 * *which arguments we pass*, not in native behavior itself.
 */

const connection = {
  isDBOpen: vi.fn().mockResolvedValue({ result: true }),
  open: vi.fn().mockResolvedValue(undefined),
  execute: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
  run: vi.fn().mockResolvedValue({ changes: { changes: 0 } }),
  query: vi.fn().mockResolvedValue({ values: [] }),
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: vi.fn().mockImplementation(() => ({
    isConnection: vi.fn().mockResolvedValue({ result: false }),
    createConnection: vi.fn().mockResolvedValue(connection),
    retrieveConnection: vi.fn().mockResolvedValue(connection),
    closeConnection: vi.fn().mockResolvedValue(undefined),
  })),
}));

const { CapacitorSqliteAdapter } = await import('../../../src/adapters/capacitor/capacitor-sqlite.adapter.js');

describe('CapacitorSqliteAdapter', () => {
  it('execute() outside a transaction lets the plugin auto-wrap (transaction: true)', async () => {
    const adapter = new CapacitorSqliteAdapter('db');
    await adapter.execute('CREATE TABLE t (id INTEGER)');
    expect(connection.execute).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER)', true);
  });

  it('execute() called from inside transaction() suppresses the plugin auto-wrap', async () => {
    const adapter = new CapacitorSqliteAdapter('db');
    await adapter.transaction(async (tx) => {
      await tx.execute('CREATE TABLE t (id INTEGER)');
    });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.execute).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER)', false);
    expect(connection.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('run() (parameterized) called from inside transaction() also suppresses the auto-wrap', async () => {
    const adapter = new CapacitorSqliteAdapter('db');
    await adapter.transaction(async (tx) => {
      await tx.execute('INSERT INTO t (id) VALUES (?)', [1]);
    });
    expect(connection.run).toHaveBeenCalledWith('INSERT INTO t (id) VALUES (?)', [1], false);
  });

  it('inTransaction flag resets after a failed transaction so the next execute() auto-wraps again', async () => {
    const adapter = new CapacitorSqliteAdapter('db');
    await expect(
      adapter.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(connection.rollbackTransaction).toHaveBeenCalledTimes(1);

    await adapter.execute('SELECT 1');
    expect(connection.execute).toHaveBeenLastCalledWith('SELECT 1', true);
  });
});
