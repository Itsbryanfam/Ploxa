"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports, platformConnections } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";
import { steamAdapter } from "./adapters/steam";
import { xboxAdapter } from "./adapters/xbox";
import { decryptSecret } from "./encryption";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";

type Platform = "steam" | "xbox";

const platformSchema = z.enum(["steam", "xbox"]);

async function requireUser() {
  const user = await getCachedUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

async function fireImportEdge(importId: string) {
  await fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
    method: "POST",
    headers: {
      apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ importId }),
  }).catch((err: unknown) => console.error("Edge Function trigger failed:", err));
}

export async function triggerImport(platform: Platform): Promise<{ importId: string }> {
  // Runtime-validate the platform — server actions take raw deserialized
  // values from the wire; the TS type alone is not a barrier.
  const validatedPlatform = platformSchema.parse(platform);
  const user = await requireUser();
  // 1 import trigger per user per 30s — each call queues an import row +
  // fires an Edge Function. Without throttling an authenticated user can
  // burn cron quota and Steam/Xbox rate-limit themselves.
  try {
    await enforceRateLimit({
      scope: "import:trigger",
      identifier: user.id,
      limit: 1,
      windowSeconds: 30,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      throw new Error("RATE_LIMITED");
    }
    throw err;
  }
  const [conn] = await db
    .select()
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.userId, user.id),
        eq(platformConnections.platform, validatedPlatform),
        eq(platformConnections.isActive, true),
      ),
    )
    .limit(1);
  if (!conn) throw new Error("NOT_CONNECTED");

  const [row] = await db
    .insert(imports)
    .values({ userId: user.id, platform: validatedPlatform, status: "queued", surfaced: true })
    .returning({ id: imports.id });

  // `after()` defers the trigger fetch until the response is sent, then
  // keeps the Vercel function instance alive until it resolves. Replaces
  // the prior `void fireImportEdge(...)` which could be killed mid-flight
  // when the serverless instance froze immediately after returning.
  after(() => fireImportEdge(row.id));
  revalidatePath("/settings");
  return { importId: row.id };
}

/** Alias — the engine reads lastSyncedAt to decide full vs delta. */
export const syncNow = triggerImport;

export async function disconnectPlatform(platform: Platform): Promise<void> {
  const user = await requireUser();
  const [conn] = await db
    .select()
    .from(platformConnections)
    .where(and(eq(platformConnections.userId, user.id), eq(platformConnections.platform, platform)))
    .limit(1);
  if (!conn) return;

  // Adapter-specific cleanup (currently no-ops for both)
  const adapter = platform === "steam" ? steamAdapter : xboxAdapter;
  await adapter.disconnect({
    id: conn.id,
    userId: conn.userId,
    platform,
    externalId: conn.externalId,
    accessTokenPlaintext: conn.accessTokenEncrypted
      ? decryptSecret(conn.accessTokenEncrypted)
      : null,
    lastSyncedAt: conn.lastSyncedAt,
  });

  await db
    .update(platformConnections)
    .set({ isActive: false, accessTokenEncrypted: null })
    .where(eq(platformConnections.id, conn.id));

  revalidatePath("/settings");
}

export interface ConnectionSummary {
  platform: Platform | "psn";
  externalId: string | null;
  lastSyncedAt: Date | null;
  isActive: boolean;
  gameCount: number;
  latestImport: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    importedCount: number;
    totalCount: number;
    /** Typed error code from the adapter (e.g. STEAM_PRIVATE_PROFILE,
     *  XBOX_KEY_INVALID). Drives platform-card recovery copy + CTA label. */
    errorMessage: string | null;
    createdAt: Date;
    surfaced: boolean;
  } | null;
}

interface RawCountRow { platform: string; count: number }
interface RawLatestRow {
  id: string;
  platform: string;
  status: "queued" | "running" | "completed" | "failed";
  imported_count: number;
  total_count: number;
  error_message: string | null;
  created_at: Date;
  surfaced: boolean;
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  const user = await requireUser();

  // Three parallel queries replace the prior O(connections) N+1:
  //   1. platform_connections rows for this user
  //   2. one aggregate over logs — distinct game count per platform
  //   3. one DISTINCT ON over imports — latest import per platform
  // Counts query unnests the platforms[] array so a single GROUP BY
  // produces a per-platform tally; latest query uses DISTINCT ON to
  // grab the most-recent row per platform in a single sort.
  const [rows, countRowsRaw, latestRowsRaw] = await Promise.all([
    db
      .select()
      .from(platformConnections)
      .where(eq(platformConnections.userId, user.id)),
    db.execute(sql`
      SELECT unnest(platforms) AS platform, COUNT(DISTINCT game_id)::int AS count
      FROM logs
      WHERE user_id = ${user.id}
      GROUP BY 1
    `),
    db.execute(sql`
      SELECT DISTINCT ON (platform)
        id, platform, status, imported_count, total_count,
        error_message, created_at, surfaced
      FROM imports
      WHERE user_id = ${user.id}
      ORDER BY platform, created_at DESC
    `),
  ]);

  const countRows = countRowsRaw as unknown as RawCountRow[];
  const latestRows = latestRowsRaw as unknown as RawLatestRow[];

  const countByPlatform = new Map<string, number>();
  for (const c of countRows) countByPlatform.set(c.platform, Number(c.count));
  const latestByPlatform = new Map<string, RawLatestRow>();
  for (const l of latestRows) latestByPlatform.set(l.platform, l);

  return rows.map((r) => {
    const latest = latestByPlatform.get(r.platform);
    return {
      platform: r.platform,
      externalId: r.externalId,
      lastSyncedAt: r.lastSyncedAt,
      isActive: r.isActive,
      gameCount: countByPlatform.get(r.platform) ?? 0,
      latestImport: latest
        ? {
            id: latest.id,
            status: latest.status,
            importedCount: Number(latest.imported_count),
            totalCount: Number(latest.total_count),
            errorMessage: latest.error_message,
            createdAt: new Date(latest.created_at),
            surfaced: latest.surfaced,
          }
        : null,
    } satisfies ConnectionSummary;
  });
}

/**
 * Marks the listed import rows as surfaced.
 * Called by ImportToast on mount after rendering the delta toast.
 *
 * Input bounded: max 50 UUIDs per call. The current caller passes only the
 * just-rendered toast IDs (typically 1-3), so 50 is generous but caps an
 * unbounded `inArray` parameter list — important since this is reachable
 * from any authenticated client and the action's input isn't otherwise
 * validated.
 */
const markImportsSurfacedInput = z.array(z.string().uuid()).max(50);

export async function markImportsSurfaced(importIds: string[]): Promise<void> {
  if (importIds.length === 0) return;
  const parsed = markImportsSurfacedInput.safeParse(importIds);
  if (!parsed.success) return;
  const user = await requireUser();
  // Drizzle's `sql` tagged template binds an array as a single string param,
  // producing `= ANY($n)` against a stringified value — postgres then rejects
  // it as a malformed array literal (`Array value must start with "{"`).
  // `inArray` does the right thing, emitting `IN (...)` with each element bound.
  await db
    .update(imports)
    .set({ surfaced: true })
    .where(and(eq(imports.userId, user.id), inArray(imports.id, parsed.data)));
}
