import "server-only";
import { and, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";

/**
 * @mentions inside backtick code fences (```…```) are skipped so a code
 * sample containing "@bob" doesn't ping the bob who exists. Escaped \@user
 * is also skipped (rare but harmless to handle).
 *
 * Returns deduplicated usernames in first-seen order.
 */
const MENTION_RE = /(?<![\w@\\])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi;
const CODE_FENCE_RE = /```[\s\S]*?```/g;

export function parseMentions(body: string): string[] {
  // Strip code fences first so mentions inside them don't match.
  const stripped = body.replace(CODE_FENCE_RE, "");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of stripped.matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export async function resolveMentionedUserIds(
  usernames: string[],
): Promise<Map<string, string>> {
  if (usernames.length === 0) return new Map();
  // Filter soft-deleted profiles: a @mention of a user mid-grace shouldn't
  // create a notification row referencing them (they revoked consent to be
  // contacted). Once the account-purge cron runs the row is gone entirely;
  // this handles the in-between 30-day grace window.
  const rows = await db
    .select({ userId: schema.profiles.userId, username: schema.profiles.username })
    .from(schema.profiles)
    .where(
      and(
        inArray(schema.profiles.username, usernames),
        isNull(schema.profiles.deletedAt),
      ),
    );
  return new Map(rows.map((r) => [r.username, r.userId]));
}
