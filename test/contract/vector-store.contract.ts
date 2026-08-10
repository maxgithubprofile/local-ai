import { beforeEach, describe, expect, it } from 'vitest';
import type { VectorStore } from '../../src/core/db/vector-store.js';
import { VectorSpaceMismatchError } from '../../src/core/errors.js';

const spaceA = { embeddingId: 'bge-small', embeddingVersion: 1, dimensions: 4 };
const spaceB = { embeddingId: 'bge-small', embeddingVersion: 2, dimensions: 4 };

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

/**
 * Shared `VectorStore` scenarios — TZ §8.2/§8.3, run against every
 * implementation. `sqlite-vec` (`SqliteVecVectorStore`) cannot be exercised
 * from this environment (no working `loadExtension()` path here — see
 * `docs/decisions.md`'s tooling notes and ADR 0002), so today this is only
 * wired to `BruteForceVectorStore` — the one path TZ guarantees ships
 * regardless (`ROADMAP.md` task 3.6).
 */
export function defineVectorStoreContract(createStore: () => Promise<VectorStore>) {
  describe('VectorStore contract', () => {
    let store: VectorStore;

    beforeEach(async () => {
      store = await createStore();
    });

    it('starts with no current space and count 0', async () => {
      expect(await store.currentSpace()).toBeNull();
      expect(await store.count()).toBe(0);
    });

    it('ensureSchema() adopts the given space', async () => {
      await store.ensureSchema(spaceA);
      expect(await store.currentSpace()).toEqual(spaceA);
    });

    it('upsert() + search() finds the closest match by cosine similarity', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0), text: 'alpha' }, spaceA);
      await store.upsert({ id: 'b', embedding: vec(0, 1, 0, 0), text: 'beta' }, spaceA);

      const hits = await store.search(vec(1, 0, 0, 0), spaceA, { topK: 5 });

      expect(hits[0]?.id).toBe('a');
      expect(hits[0]?.text).toBe('alpha');
      expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? -Infinity);
    });

    it('upsertMany() inserts every entry', async () => {
      await store.ensureSchema(spaceA);
      await store.upsertMany(
        [
          { id: 'a', embedding: vec(1, 0, 0, 0) },
          { id: 'b', embedding: vec(0, 1, 0, 0) },
          { id: 'c', embedding: vec(0, 0, 1, 0) },
        ],
        spaceA,
      );
      expect(await store.count()).toBe(3);
    });

    it('upsert() on an existing id replaces it rather than duplicating', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0), text: 'first' }, spaceA);
      await store.upsert({ id: 'a', embedding: vec(0, 1, 0, 0), text: 'second' }, spaceA);

      expect(await store.count()).toBe(1);
      const hits = await store.search(vec(0, 1, 0, 0), spaceA, { topK: 1 });
      expect(hits[0]?.text).toBe('second');
    });

    it('search() respects topK', async () => {
      await store.ensureSchema(spaceA);
      await store.upsertMany(
        [
          { id: 'a', embedding: vec(1, 0, 0, 0) },
          { id: 'b', embedding: vec(0.9, 0.1, 0, 0) },
          { id: 'c', embedding: vec(0, 1, 0, 0) },
        ],
        spaceA,
      );
      const hits = await store.search(vec(1, 0, 0, 0), spaceA, { topK: 2 });
      expect(hits).toHaveLength(2);
    });

    it('search() applies a metadata filter', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0), metadata: { chatId: 'x' } }, spaceA);
      await store.upsert({ id: 'b', embedding: vec(0.99, 0.01, 0, 0), metadata: { chatId: 'y' } }, spaceA);

      const hits = await store.search(vec(1, 0, 0, 0), spaceA, { topK: 5, filter: { chatId: 'y' } });
      expect(hits.map((h) => h.id)).toEqual(['b']);
    });

    it('delete() removes an entry', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0) }, spaceA);
      await store.delete('a');
      expect(await store.count()).toBe(0);
    });

    it('upsert() with a space that does not match the current one throws VectorSpaceMismatchError', async () => {
      await store.ensureSchema(spaceA);
      await expect(store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0) }, spaceB)).rejects.toThrow(
        VectorSpaceMismatchError,
      );
    });

    it('search() with a mismatched space throws VectorSpaceMismatchError', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0) }, spaceA);
      await expect(store.search(vec(1, 0, 0, 0), spaceB)).rejects.toThrow(VectorSpaceMismatchError);
    });

    it('ensureSchema() with a different space while data exists throws VectorSpaceMismatchError', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0) }, spaceA);
      await expect(store.ensureSchema(spaceB)).rejects.toThrow(VectorSpaceMismatchError);
    });

    it('reindex() wipes existing vectors and adopts the new space, unblocking further writes', async () => {
      await store.ensureSchema(spaceA);
      await store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0) }, spaceA);

      await store.reindex(spaceB);

      expect(await store.count()).toBe(0);
      expect(await store.currentSpace()).toEqual(spaceB);
      await expect(store.upsert({ id: 'a', embedding: vec(1, 0, 0, 0) }, spaceB)).resolves.toBeUndefined();
    });
  });
}
