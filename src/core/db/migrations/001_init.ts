/**
 * Initial schema — transcribed verbatim from TZ §8.1. Applied by the
 * migration runner (`../database.ts`) inside a single transaction; tracked
 * as row `(1, '001_init', <applied_at>)` in `_local_ai_migrations`.
 *
 * Migrations are `.ts` files exporting a `sql` string constant rather than
 * bare `.sql` files — this package builds with `tsup`/esbuild and ships to
 * consumers who bundle it with their own tooling (Metro/Vite/webpack for a
 * Capacitor app); a runtime `FileSystemPort.readFile()` of the package's
 * own internal `.sql` files would be fragile across those bundlers/mobile
 * targets, and configuring a `.sql`-as-text loader identically across
 * `tsup` (esbuild) *and* `vitest` (Vite) added tooling surface for no real
 * benefit over just writing the SQL as a template string. See
 * `docs/decisions.md`'s "Implementation/tooling notes" section. `add-migration`'s
 * conventions (numbered, additive-only, snake_case, TZ section comment)
 * otherwise apply unchanged — only the file extension differs.
 */
export const sql = `
CREATE TABLE IF NOT EXISTS _local_ai_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,           -- JSON: manifest cache/ETag, local eligibility verdicts (§6.3), etc.
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_artifacts (
  kind TEXT NOT NULL CHECK (kind IN ('model','embedding')),
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  installed_at TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, artifact_id, version)
);

CREATE TABLE IF NOT EXISTS download_state (
  key TEXT PRIMARY KEY,
  transport_task_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model','embedding')),
  url TEXT NOT NULL,
  destination_filename TEXT NOT NULL,
  size_bytes_expected INTEGER NOT NULL,
  sha256_expected TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

-- Chats (§9)
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT                  -- JSON, arbitrary app fields
);

CREATE TABLE IF NOT EXISTS chat_messages (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  id TEXT NOT NULL,              -- caller-supplied id; unique WITHIN chat_id, not globally
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','cancelled','error')),  -- see §9.8
  created_at TEXT NOT NULL,
  token_count INTEGER,
  metadata TEXT,                 -- JSON
  PRIMARY KEY (chat_id, id)       -- basis of idempotent appendMessages: INSERT OR IGNORE on this key
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, created_at);

-- Single row — which embedding space the vectors currently stored in
-- VectorStore (§8.2) actually correspond to. Basis of the hard guard
-- against silently searching an incompatible embedding space (§8.3).
CREATE TABLE IF NOT EXISTS vector_space (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  embedding_id TEXT NOT NULL,
  embedding_version INTEGER NOT NULL,
  dimensions INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`;
