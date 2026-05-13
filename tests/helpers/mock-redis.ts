/**
 * In-memory stand-in for the subset of @upstash/redis the AI router uses.
 *
 * Why this exists: the router's reserve/release flow is atomic at the Redis
 * level (`INCR` returns the post-increment value, used to compare against
 * the cap). Hitting real Upstash for tests would couple Vitest runs to
 * network state and the free-tier rate limit. A local in-memory map mimics
 * the same semantics for the four methods we actually call (`get`, `incr`,
 * `decr`, `expire`) and exposes `clear()` so tests can isolate state in
 * beforeEach.
 *
 * If lib/cache/redis.ts grows new method calls, mirror them here — the
 * tests will fail loudly until you do.
 */

type StoredValue = number | string;
type Entry = { value: StoredValue; expiresAt: number | null };

export interface MockRedis {
  get<T = unknown>(key: string): Promise<T | null>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  // Test helpers — not part of the real @upstash/redis surface.
  clear(): void;
  size(): number;
  inspect(key: string): StoredValue | undefined;
}

export function createMockRedis(): MockRedis {
  const store = new Map<string, Entry>();

  function read(key: string): Entry | undefined {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const entry = read(key);
      return (entry?.value ?? null) as T | null;
    },
    async incr(key: string): Promise<number> {
      const entry = read(key);
      const current = typeof entry?.value === "number" ? entry.value : 0;
      const next = current + 1;
      store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async decr(key: string): Promise<number> {
      const entry = read(key);
      const current = typeof entry?.value === "number" ? entry.value : 0;
      const next = current - 1;
      store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async expire(key: string, seconds: number): Promise<void> {
      const entry = store.get(key);
      if (!entry) return;
      entry.expiresAt = Date.now() + seconds * 1000;
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
    inspect(key: string) {
      return read(key)?.value;
    },
  };
}
