"use server";
import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports, platformConnections } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";
import { steamAdapter } from "./adapters/steam";
import { xboxAdapter } from "./adapters/xbox";
import { decryptSecret } from "./encryption";

type Platform = "steam" | "xbox";

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
  const user = await requireUser();
  const [conn] = await db
    .select()
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.userId, user.id),
        eq(platformConnections.platform, platform),
        eq(platformConnections.isActive, true),
      ),
    )
    .limit(1);
  if (!conn) throw new Error("NOT_CONNECTED");

  const [row] = await db
    .insert(imports)
    .values({ userId: user.id, platform, status: "queued", surfaced: true })
    .returning({ id: imports.id });

  void fireImportEdge(row.id);
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
    createdAt: Date;
    surfaced: boolean;
  } | null;
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(platformConnections)
    .where(eq(platformConnections.userId, user.id));

  const summaries = await Promise.all(
    rows.map(async (r) => {
      // game count: distinct game_ids in logs for this user where platforms contains this platform
      const countRows = await db.execute<{ count: number }>(sql`
        SELECT COUNT(DISTINCT game_id)::int AS count FROM logs
        WHERE user_id = ${user.id} AND ${r.platform} = ANY(platforms)
      `);
      const gameCount = Number((countRows as unknown as Array<{ count: number }>)[0]?.count ?? 0);

      const [latest] = await db
        .select({
          id: imports.id,
          status: imports.status,
          importedCount: imports.importedCount,
          totalCount: imports.totalCount,
          createdAt: imports.createdAt,
          surfaced: imports.surfaced,
        })
        .from(imports)
        .where(and(eq(imports.userId, user.id), eq(imports.platform, r.platform)))
        .orderBy(desc(imports.createdAt))
        .limit(1);

      return {
        platform: r.platform,
        externalId: r.externalId,
        lastSyncedAt: r.lastSyncedAt,
        isActive: r.isActive,
        gameCount,
        latestImport: latest ?? null,
      } satisfies ConnectionSummary;
    }),
  );

  return summaries;
}

/**
 * Marks the listed import rows as surfaced.
 * Called by ImportToast on mount after rendering the delta toast.
 */
export async function markImportsSurfaced(importIds: string[]): Promise<void> {
  if (importIds.length === 0) return;
  const user = await requireUser();
  await db
    .update(imports)
    .set({ surfaced: true })
    .where(and(eq(imports.userId, user.id), sql`${imports.id} = ANY(${importIds})`));
}
