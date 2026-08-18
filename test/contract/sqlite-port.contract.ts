import { beforeEach, describe, expect, it } from 'vitest';
import type { SqlitePort } from '../../src/core/ports/sqlite.port.js';

/**
 * Shared `SqlitePort` scenarios, parametrized like every other
 * `test/contract` file. `create()` hands back a fresh, already-usable
 * `SqlitePort` — no migrations needed, this contract only touches a scratch
 * table it creates itself.
 *
 * The concurrency scenarios below exist to pin the port's own doc comment
 * (`SqlitePort.transaction()`): overlapping `transaction()` calls on one
 * adapter instance must queue, not race the underlying connection. This is
 * the exact bug class behind `docs/decisions.md`'s "`CapacitorSqliteAdapter`
 * concurrent-connection/transaction hardening" entry — caught there only via
 * a production consumer, because `CapacitorSqliteAdapter` needs a real
 * device/emulator bridge and never runs under `pnpm test` (CLAUDE.md's
 * testing rule). This contract runs against `NodeSqliteAdapter` instead,
 * which shared the identical un-serialized `transaction()` gap and is fully
 * testable in Node — so this is the automated regression guard for both
 * adapters' shared contract, even though it can only execute one of them.
 */
export function defineSqlitePortContract(create: () => Promise<{ sqlite: SqlitePort }>) {
  describe('SqlitePort contract', () => {
    let sqlite: SqlitePort;

    beforeEach(async () => {
      ({ sqlite } = await create());
      await sqlite.execute('CREATE TABLE IF NOT EXISTS scratch (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)');
    });

    it('transaction() commits its writes', async () => {
      await sqlite.transaction(async (tx) => {
        await tx.execute('INSERT INTO scratch (value) VALUES (?)', ['a']);
      });
      expect(await sqlite.query<{ value: string }>('SELECT value FROM scratch')).toEqual([{ value: 'a' }]);
    });

    it('transaction() rolls back every write when fn throws', async () => {
      await expect(
        sqlite.transaction(async (tx) => {
          await tx.execute('INSERT INTO scratch (value) VALUES (?)', ['a']);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await sqlite.query('SELECT value FROM scratch')).toEqual([]);
    });

    it('two overlapping transaction() calls both complete instead of racing on BEGIN', async () => {
      const write = (value: string) =>
        sqlite.transaction(async (tx) => {
          // Yield a turn between BEGIN and the write, so a second
          // transaction() call started before this one commits has a real
          // window to race — what an un-serialized adapter (the bug this
          // guards against) throws "already in transaction" on.
          await new Promise((resolve) => setTimeout(resolve, 0));
          await tx.execute('INSERT INTO scratch (value) VALUES (?)', [value]);
        });

      await Promise.all([write('first'), write('second')]);

      const rows = await sqlite.query<{ value: string }>('SELECT value FROM scratch ORDER BY value');
      expect(rows.map((r) => r.value)).toEqual(['first', 'second']);
    });

    it('a rejected transaction() does not block transactions queued after it', async () => {
      const failing = sqlite.transaction(async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await tx.execute('INSERT INTO scratch (value) VALUES (?)', ['will-rollback']);
        throw new Error('boom');
      });
      const succeeding = sqlite.transaction(async (tx) => {
        await tx.execute('INSERT INTO scratch (value) VALUES (?)', ['will-commit']);
      });

      await expect(failing).rejects.toThrow('boom');
      await expect(succeeding).resolves.toBeUndefined();

      const rows = await sqlite.query<{ value: string }>('SELECT value FROM scratch');
      expect(rows.map((r) => r.value)).toEqual(['will-commit']);
    });
  });
}
