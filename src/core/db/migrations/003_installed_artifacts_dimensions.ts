/**
 * Adds `dimensions` to `installed_artifacts` (TZ §8.1's original schema
 * didn't carry it) — needed so `LocalAiClient.switchEmbedding()` can report
 * the *previous* embedding's `dimensions` in the public
 * `vector-store:embedding-changed` event (TZ §5.6) without re-fetching an
 * old manifest. `NULL`/meaningless for `kind = 'model'` rows. Additive-only
 * per the `add-migration` skill's rules — `001_init.ts`/`002_vector_entries.ts`
 * are unchanged.
 */
export const sql = `
ALTER TABLE installed_artifacts ADD COLUMN dimensions INTEGER;
`;
