/**
 * Backing tables for `VectorStore` (TZ §8.2/§8.3) — both created
 * unconditionally, regardless of which implementation ends up active at
 * runtime (`src/core/db/create-vector-store.ts` decides that per-device,
 * opportunistically). See `001_init.ts`'s doc comment for why migrations
 * are `.ts` files exporting a `sql` string, not bare `.sql`.
 */
export const sql = `
-- Brute-force fallback's backing store (TZ §8.3) — cosine similarity
-- computed in TS over this table's BLOB column. Always created and always
-- usable, independent of whether sqlite-vec's virtual table below can be
-- loaded on this device.
CREATE TABLE IF NOT EXISTS vector_entries (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,       -- packed little-endian float32, see brute-force-vector-store.ts
  text TEXT,
  metadata TEXT                  -- JSON
);

-- sqlite-vec primary path's companion table (TZ §8.2). A \`vec0\` virtual
-- table only stores its declared vector column(s) plus an implicit integer
-- \`rowid\` — it cannot hold our caller-supplied string \`id\`, \`text\`, or
-- \`metadata\` directly, so those live here, joined back to the vec0 table's
-- \`rowid\` by sqlite-vec-vector-store.ts. The vec0 virtual table itself is
-- NOT created here — its column width depends on \`VectorSpaceDescriptor.dimensions\`,
-- known only at runtime (\`ensureSchema()\`/\`reindex()\`), not at migration time.
CREATE TABLE IF NOT EXISTS vector_meta (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  text TEXT,
  metadata TEXT                  -- JSON
);
`;
