import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import {
  runImport,
  type ImportRow,
  type ConnectionRow,
} from "../_shared/import-engine.ts";
import { requireServiceRole } from "../_shared/auth.ts";

// `EdgeRuntime` is injected by the Supabase Edge Functions Deno runtime.
// `waitUntil` keeps the isolate alive until the promise settles so our
// fire-and-forget refresh-fingerprint trigger fetches actually complete
// after we return the response. Same pattern as taste-drift-cron and
// daily-sync.
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

/**
 * Best-effort refresh-fingerprint trigger. Bulk imports write logs via raw
 * SQL inside `runImport`, never going through `lib/logs/server-actions.ts`
 * — so the Next-side `triggerOnLogWrite` (which fires refresh on milestone
 * counts of 10/25/50/100/250) never runs for imported users.
 *
 * Fired only on successful imports; the refresh-fingerprint function
 * itself short-circuits with `{ tier: "empty" }` when the user has no
 * logs, so an empty-but-completed import wastes one cheap call.
 * Failures are swallowed so an AI provider outage never fails the
 * import response. The Next-side `getRecs` already tolerates a missing
 * fingerprint via the live-vectors path (since c4fa727), so this is
 * best-effort enrichment, not a hard dependency.
 */
async function fireRefreshFingerprint(userId: string): Promise<void> {
  const functionsUrl =
    Deno.env.get("SUPABASE_FUNCTIONS_URL") ??
    (Deno.env.get("SUPABASE_URL")
      ? `${Deno.env.get("SUPABASE_URL")}/functions/v1`
      : null);
  const apikey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!functionsUrl || !apikey) {
    console.warn(
      "import-platform: skipping refresh-fingerprint — missing SUPABASE_FUNCTIONS_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return;
  }
  const triggerPromise = fetch(`${functionsUrl}/refresh-fingerprint`, {
    method: "POST",
    headers: { apikey, "Content-Type": "application/json" },
    body: JSON.stringify({ userId, reason: "post-import" }),
  })
    .then(async (r) => {
      if (!r.ok) {
        console.warn(
          `import-platform: refresh-fingerprint non-OK ${r.status} for ${userId}: ${await r.text().catch(() => "<unreadable>")}`,
        );
      }
    })
    .catch((err: unknown) => {
      console.warn(
        `import-platform: refresh-fingerprint fetch failed for ${userId}:`,
        err,
      );
    });
  // Production: hand the promise to waitUntil so the isolate stays alive
  // until the trigger settles, then return immediately so the import
  // response isn't delayed.
  // Local dev (no EdgeRuntime global): await inline so `supabase functions
  // serve` doesn't drop the trigger when the worker exits.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(triggerPromise);
    return;
  }
  await triggerPromise;
}

Deno.serve(async (req) => {
  // Auth: service-role key via `apikey` header. See _shared/auth.ts for
  // constant-time comparison rationale. Supabase's newer `sb_secret_*`
  // keys aren't JWTs — Edge Functions deploy with `--no-verify-jwt`.
  //   https://supabase.com/docs/guides/api/api-keys
  //   https://supabase.com/docs/guides/functions/auth
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  let body: { importId?: string };
  try {
    body = (await req.json()) as { importId?: string };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }

  const { importId } = body;
  if (!importId) return new Response("missing importId", { status: 400 });

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    const importRows = await sql<
      ImportRow[]
    >`SELECT * FROM imports WHERE id = ${importId} LIMIT 1`;
    if (!importRows.length) {
      return new Response("import not found", { status: 404 });
    }
    const importRow = importRows[0];

    const connRows = await sql<ConnectionRow[]>`
      SELECT * FROM platform_connections
      WHERE user_id = ${importRow.user_id}
        AND platform = ${importRow.platform}::platform_kind
      LIMIT 1
    `;
    if (!connRows.length) {
      await sql`
        UPDATE imports
        SET status = 'failed', error_message = 'connection not found'
        WHERE id = ${importId}
      `;
      return new Response("connection not found", { status: 404 });
    }

    const result = await runImport({
      sql,
      importRow,
      connection: connRows[0],
      steamApiKey: Deno.env.get("STEAM_API_KEY") ?? null,
      encryptionKey: Deno.env.get("IMPORT_ENCRYPTION_KEY")!,
    });

    // Fire-and-forget refresh-fingerprint on successful imports. We don't
    // refresh on `status: "failed"` — the partial logs that were committed
    // before the failure will get picked up on the next successful import
    // or on the daily drift cron. Awaited so local-dev (no EdgeRuntime)
    // doesn't drop the trigger; in production this returns immediately
    // because waitUntil takes ownership inside the helper.
    if (result.status === "completed") {
      await fireRefreshFingerprint(importRow.user_id);
    }

    return Response.json(result);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
