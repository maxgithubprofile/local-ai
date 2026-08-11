import { beforeEach, describe, expect, it } from 'vitest';
import { LogStore } from '../../src/core/logging/log-store.js';
import type { SqlitePort } from '../../src/core/ports/sqlite.port.js';
import type { ClockPort } from '../../src/core/ports/clock.port.js';

/**
 * Shared `LogStore` scenarios (ROADMAP.md's "Local logging & export"
 * section, LOG.2) — parametrized over every `SqlitePort` implementation
 * with migrations already applied, exactly like `conversation-store.contract.ts`.
 */
export function defineLogStoreContract(create: () => Promise<{ sqlite: SqlitePort; clock: ClockPort & { advance?: (ms: number) => void } }>) {
  describe('LogStore contract', () => {
    let store: LogStore;
    let sqlite: SqlitePort;
    let clock: ClockPort & { advance?: (ms: number) => void };

    beforeEach(async () => {
      const ctx = await create();
      sqlite = ctx.sqlite;
      clock = ctx.clock;
      store = new LogStore(ctx.sqlite, ctx.clock);
    });

    it('append() persists a row readable via query()', async () => {
      await store.append({ level: 'info', message: 'hello' });
      const rows = await store.query();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ level: 'info', message: 'hello' });
      expect(rows[0]?.id).toBeTypeOf('number');
      expect(rows[0]?.ts).toBeTruthy();
    });

    it('append() stamps ts from ClockPort, not Date.now()', async () => {
      await store.append({ level: 'info', message: 'm' });
      const [entry] = await store.query();
      expect(entry?.ts).toBe(clock.nowIso());
    });

    it('append() round-trips a meta payload through JSON', async () => {
      await store.append({ level: 'error', message: 'boom', meta: { code: 'x', nested: { n: 1 } } });
      const [entry] = await store.query();
      expect(entry?.meta).toEqual({ code: 'x', nested: { n: 1 } });
    });

    it('append() with no meta leaves meta undefined, not null or {}', async () => {
      await store.append({ level: 'debug', message: 'no meta' });
      const [entry] = await store.query();
      expect(entry?.meta).toBeUndefined();
    });

    it('query() returns entries oldest first', async () => {
      await store.append({ level: 'info', message: 'first' });
      clock.advance?.(1000);
      await store.append({ level: 'info', message: 'second' });

      const rows = await store.query();
      expect(rows.map((r) => r.message)).toEqual(['first', 'second']);
    });

    it('query({ since }) only returns entries at or after the given ISO timestamp', async () => {
      await store.append({ level: 'info', message: 'old' });
      clock.advance?.(60_000);
      const cutoff = clock.nowIso();
      await store.append({ level: 'info', message: 'new' });

      const rows = await store.query({ since: cutoff });
      expect(rows.map((r) => r.message)).toEqual(['new']);
    });

    it('query({ level }) is a minimum-severity threshold, not an exact match', async () => {
      await store.append({ level: 'debug', message: 'd' });
      await store.append({ level: 'info', message: 'i' });
      await store.append({ level: 'warn', message: 'w' });
      await store.append({ level: 'error', message: 'e' });

      const rows = await store.query({ level: 'warn' });
      expect(rows.map((r) => r.message)).toEqual(['w', 'e']);
    });

    it('query({ limit, offset }) paginates', async () => {
      for (let i = 0; i < 5; i++) {
        await store.append({ level: 'info', message: `m${i}` });
      }
      const page = await store.query({ limit: 2, offset: 2 });
      expect(page.map((r) => r.message)).toEqual(['m2', 'm3']);
    });

    it('append() prunes rows past maxEntries, oldest first', async () => {
      const bounded = new LogStore(sqlite, clock, { maxEntries: 3 });
      for (let i = 0; i < 5; i++) {
        await bounded.append({ level: 'info', message: `m${i}` });
      }
      const rows = await bounded.query();
      expect(rows.map((r) => r.message)).toEqual(['m2', 'm3', 'm4']);
    });

    it('clear() removes every entry', async () => {
      await store.append({ level: 'info', message: 'm' });
      await store.clear();
      expect(await store.query()).toEqual([]);
    });
  });
}
