import "server-only";
import { z } from "zod";
import { requireEnv } from "@/lib/env";

const RAWG_BASE = "https://api.rawg.io/api";

class RawgError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "RawgError";
  }
}

interface RawgFetchOptions {
  path: string;
  params?: Record<string, string | number>;
  schema: z.ZodSchema;
  next?: { revalidate?: number };
}

export async function rawgFetch<T>({ path, params = {}, schema, next }: RawgFetchOptions): Promise<T> {
  const apiKey = requireEnv("RAWG_API_KEY");
  const url = new URL(`${RAWG_BASE}${path}`);
  url.searchParams.set("key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { next });

  if (res.status === 429) {
    throw new RawgError("RAWG rate limit hit", 429);
  }
  if (!res.ok) {
    throw new RawgError(`RAWG ${res.status}: ${res.statusText}`, res.status);
  }

  const json = await res.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error("RAWG response shape mismatch", parsed.error.issues.slice(0, 3));
    throw new RawgError("RAWG response failed validation");
  }
  return parsed.data as T;
}
