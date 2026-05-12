import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import {
  runImport,
  type ImportRow,
  type ConnectionRow,
} from "../_shared/import-engine.ts";

Deno.serve(async (req) => {
  // Auth: service-role key via `apikey` header (NOT `Authorization: Bearer`).
  // Supabase's newer `sb_secret_*` keys are not JWTs — Edge Functions must be
  // deployed with `--no-verify-jwt` and validate via string-equality on the
  // `apikey` header. See:
  //   https://supabase.com/docs/guides/api/api-keys
  //   https://supabase.com/docs/guides/functions/auth
  const apikey = req.headers.get("apikey");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apikey || !serviceRoleKey || apikey !== serviceRoleKey) {
    return new Response("Unauthorized", { status: 401 });
  }

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

    return Response.json(result);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
