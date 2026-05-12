import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";

Deno.serve(async (req) => {
  // Auth via `apikey` header (sb_secret_* keys aren't JWTs; deploy with --no-verify-jwt).
  const apikey = req.headers.get("apikey");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apikey || !serviceRoleKey || apikey !== serviceRoleKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const functionsUrl = Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? Deno.env.get("SUPABASE_URL") + "/functions/v1";
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
        // Fire-and-forget — apikey header per sb_secret_* convention
        fetch(`${functionsUrl}/import-platform`, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ importId: row.id }),
        }).catch((err) => console.error("import-platform trigger failed:", err));
        scheduled++;
      });
      await Promise.all(jobs);
    }

    return Response.json({ scheduled });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
