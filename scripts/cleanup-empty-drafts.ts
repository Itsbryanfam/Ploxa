/**
 * One-off cleanup: delete the user's unpublished review drafts. These
 * accumulated during the Phase 2 manual-sweep debugging when AI provider
 * 404s caused the up-front reviews-row insert to succeed but the streamed
 * body never persisted.
 *
 * Run with: `pnpm exec tsx scripts/cleanup-empty-drafts.ts`
 *
 * Safe to delete this file after a one-time run; it has no callers in the
 * app code.
 */
import "dotenv/config";
import { isNull } from "drizzle-orm";
import { db, schema } from "../lib/db";

async function main() {
  // Show what's there first
  const existing = await db
    .select({
      id: schema.reviews.id,
      gameId: schema.reviews.gameId,
      bodyLen: schema.reviews.body,
      publishedAt: schema.reviews.publishedAt,
    })
    .from(schema.reviews)
    .where(isNull(schema.reviews.publishedAt));
  console.log(`Found ${existing.length} unpublished draft(s):`);
  for (const r of existing) {
    console.log(
      `  review=${r.id} game=${r.gameId} bodyLen=${(r.bodyLen ?? "").length}`,
    );
  }

  const rows = await db
    .delete(schema.reviews)
    .where(isNull(schema.reviews.publishedAt))
    .returning({ id: schema.reviews.id });
  console.log(`Deleted ${rows.length} draft(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
