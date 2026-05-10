import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireEnv } from "@/lib/env";
import * as schema from "@/lib/db/schema";

declare global {
  // eslint-disable-next-line no-var
  var __dbClient: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = requireEnv("DATABASE_URL");
  return postgres(url, {
    prepare: false, // Supabase pooler (port 6543) doesn't support prepared statements
    max: 5,
  });
}

const client = global.__dbClient ?? createClient();
if (process.env.NODE_ENV !== "production") global.__dbClient = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
export { schema };
