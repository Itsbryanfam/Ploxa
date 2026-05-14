# `lib/db` — Database schema, migrations, and policies

This folder holds everything the app knows about the Postgres schema:

- **`schema.ts`** — Drizzle ORM table definitions. The TypeScript source of truth.
- **`schema-types.ts`** — Re-exported row/insert types and string unions derived from the enums in `schema.ts`. Import from here, not `schema.ts`, when you only need types.
- **`index.ts`** — Drizzle client + connection setup.
- **`migrations/`** — Hand-authored SQL migration files + drizzle-kit metadata (`meta/_journal.json` + `meta/00NN_snapshot.json`).
- **`policies/`** — RLS policy SQL applied separately from migrations.

## Migration convention: hand-authored, NOT generated

Migrations in this project are written **by hand**. `drizzle-kit generate` is used only to detect drift (via `pnpm db:check`), never to produce the canonical SQL that ships.

Why hand-authored:

1. **CONCURRENTLY indexes on hot tables.** Drizzle generates `CREATE INDEX` (no CONCURRENTLY), which takes an `AccessShareLock` and briefly stalls reads on the target table. For indexes on `profiles`, `logs`, `reviews`, `comments`, `follows`, `likes`, `notifications`, and `games`, we use `CREATE INDEX CONCURRENTLY` instead. See `migrations/README.md` for full rationale.

2. **Partial indexes with WHERE predicates.** Drizzle's partial-index DSL is limited; some of our indexes (e.g. `games_steam_appid_idx`) need predicate clauses that drizzle-kit emits incorrectly.

3. **Data backfills.** Some migrations include `UPDATE` statements alongside DDL (e.g. backfilling `logs.last_event_at`). Drizzle's diff-based generator can't author those.

4. **Supabase MCP application split.** Transactional DDL goes through `mcp__supabase__apply_migration`; CONCURRENTLY indexes go through `mcp__supabase__execute_sql` (no transaction wrapper). When a single logical change needs both, we split into two numbered files.

## Workflow for adding a migration

1. **Author the SQL by hand** in `lib/db/migrations/00NN_short_description.sql`. Reserve the next sequential 4-digit prefix. Add a header comment explaining what the migration does and why it's hand-authored.

2. **Update `schema.ts`** to match the new schema state.

3. **Update the snapshot chain.** Run `pnpm drizzle-kit generate` once, then:
   - If it emits a fresh `.sql` file matching what you wrote by hand, **delete the generated .sql** (keep your hand-authored version).
   - **Keep the generated `meta/00NN_snapshot.json`** — that's the snapshot we need.
   - **Keep the generated `meta/_journal.json` entry** for the new migration.

4. **Run `pnpm db:check`** to confirm zero drift. The command exits 0 only when:
   - The journal/snapshot chain is internally consistent (`drizzle-kit check` passes), AND
   - `drizzle-kit generate` produces no new files (schema.ts matches the latest snapshot).

5. **Apply to the live DB** via the appropriate Supabase MCP tool (see `migrations/README.md`).

## `pnpm db:check` (CI gate)

`scripts/check-drizzle-sync.ts` runs in two passes:

1. `drizzle-kit check` — validates the journal/snapshot UUID chain.
2. `drizzle-kit generate` (in revert-on-side-effect mode) — fails if schema.ts has drifted from the snapshot chain. Any new `.sql`, snapshot, or journal entry produced is auto-deleted before exit, so the working tree stays clean either way.

Wire this into pre-commit / CI to catch the drift class that broke us three times historically (Phase 5, IGDB facets, settings overhaul). See `feedback_drizzle_snapshot_chain_drift.md` in the memory store.

## Snapshot chain reconciliation (2026-05-14)

The snapshot chain was reconstructed in T17 of `audit-fixes-2026-05-14` (commit on this branch). Snapshots 0007-0011 and 0013-0014 had never been committed; 0012's snapshot existed but pointed at 0006's id, skipping the missing files. The fix:

- Generated a fresh full-state snapshot from current `schema.ts`.
- Used it as the content for `0015_snapshot.json` (the latest migration's post-state).
- Created bridging snapshots for 0007-0011 and 0013-0014 with the same content but distinct UUIDs, chained via `prevId` so the journal entries all resolve.
- Re-pointed `0012_snapshot.json`'s `prevId` from 0006's id to 0011's id (so the chain is contiguous; the intra-snapshot content of 0012 is unchanged — it still reflects the post-IGDB-facets state pre-0013).

The bridging snapshots for 0007-0011 do NOT reflect the schema state at those intermediate points — they all carry the current full-state schema. This is fine for drizzle's purposes: drizzle only reads the latest snapshot to detect drift on `generate`. The chain integrity matters for `drizzle-kit check`, which we pass. No further intermediate-state reconstruction is feasible since `schema.ts` only preserves the latest state.

Future migrations work from 0016+ following the workflow above.
