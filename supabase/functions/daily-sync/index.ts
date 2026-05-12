import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";

// `EdgeRuntime` is injected by the Supabase Edge Functions Deno runtime.
// `waitUntil` keeps the isolate alive until the promise settles, so our
// fire-and-forget trigger fetches actually complete after we return the
// response to the cron caller. Without it the isolate may terminate
// mid-fetch and trigger requests silently drop.
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
} | undefined;

Deno.serve(async (req) => {
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const functionsUrl =
    Deno.env.get("SUPABASE_FUNCTIONS_URL") ??
    Deno.env.get("SUPABASE_URL") + "/functions/v1";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    const conns = await sql<Array<{ id: string; user_id: string; platform: string }>>`
      SELECT id, user_id, platform FROM platform_connections
      WHERE is_active = true
        AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '23 hours')
    `;

    // Concurrency cap = 10
    const CHUNK = 10;
    let scheduled = 0;
    for (let i = 0; i < conns.length; i += CHUNK) {
      const slice = conns.slice(i, i + CHUNK);
      const jobs = slice.map(async (c) => {
        const [row] = await sql<Array<{ id: string }>>`
          INSERT INTO imports (user_id, platform, status, surfaced)
          VALUES (${c.user_id}, ${c.platform}::platform_kind, 'queued', false)
          RETURNING id
        `;
        // Background trigger: kick off import-platform but don't block
        // the cron response on it. `EdgeRuntime.waitUntil` keeps the
        // isolate alive so the fetch isn't truncated when we return.
        const triggerPromise = fetch(`${functionsUrl}/import-platform`, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ importId: row.id }),
        }).catch((err) =>
          console.error("import-platform trigger failed:", row.id, err),
        );
        if (typeof EdgeRuntime !== "undefined") {
          EdgeRuntime.waitUntil(triggerPromise);
        } else {
          // Local-dev fallback (no EdgeRuntime global) — await inline.
          await triggerPromise;
        }
        scheduled++;
      });
      await Promise.all(jobs);
    }

    return Response.json({ scheduled });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
