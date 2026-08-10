---
name: add-migration
description: Add the next numbered SQL migration file under src/core/db/migrations/ for local-ai, following the TZ §8.1 schema conventions. Use when a task needs a new table, column, or index in the library's SQLite schema.
---

# add-migration

## Steps

1. **Read the existing schema** — `src/core/db/migrations/001_init.sql` (transcribed verbatim from
   TZ §8.1: `_local_ai_migrations`, `kv_store`, `installed_artifacts`, `download_state`, `chats`,
   `chat_messages`, `vector_space`) and any later-numbered migration files, so the new one is
   additive and doesn't duplicate a column/table.

2. **Pick the next number.** Files are `NNN_description.sql`, zero-padded to 3 digits, strictly
   increasing (`002_...`, `003_...`, …) — never reuse or reorder a number once merged.

3. **Write the migration** as plain SQL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`, `CREATE INDEX
   IF NOT EXISTS`, …), consistent with the existing style: snake_case columns, `TEXT` for
   ISO-8601 timestamps (`*_at` columns), `CHECK` constraints for enum-like columns, a comment above
   any table explaining its purpose and linking the TZ section it implements.

4. **Do not edit `001_init.sql`** (or any already-merged migration) to change its effect — SQLite
   migrations are append-only here; a correction to an already-shipped migration is itself a new
   migration.

5. Extend the migration-runner test (`test/unit/db/` or `test/integration/db/`, per `ROADMAP.md`
   Phase 3) so the new migration is exercised: applying it from a fresh DB, and applying it on top of
   a DB that already has `001_init.sql` applied.

6. If the new table/column affects `VectorStore`, `ConversationStore`, or `ModelRegistry` semantics
   described in the TZ, note that explicitly in the migration's file-header comment — a future agent
   reading just the SQL should not have to re-derive the reasoning from the TZ.
