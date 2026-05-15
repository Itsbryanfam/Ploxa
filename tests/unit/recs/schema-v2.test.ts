import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
// Import schema directly from the schema module, NOT from `@/lib/db`.
// `@/lib/db` (lib/db/index.ts) instantiates a postgres-js client at import
// time, which requires DATABASE_URL and fails under Vitest. `lib/db/index.ts`
// re-exports this exact same `schema` object via `export * as schema`, so the
// assertions are identical — we just skip the connection side effect and test
// the real schema (not a vi.mock stub). This mirrors the existing
// tests/unit/recaps/schema.test.ts convention for schema-delta tests.
import * as schema from "@/lib/db/schema";

describe("Play-next redesign schema additions", () => {
  it("exports recSlotEnum with 4 values", () => {
    expect(schema.recSlotEnum.enumValues).toEqual([
      "comfort",
      "backlog",
      "friends",
      "wildcard",
    ]);
  });

  it("recommendations has slot column", () => {
    const cols = Object.keys(getTableColumns(schema.recommendations));
    expect(cols).toContain("slot");
  });

  it("recommendations has dismissedAt, snoozedUntil, neverAgain columns", () => {
    const cols = Object.keys(getTableColumns(schema.recommendations));
    expect(cols).toContain("dismissedAt");
    expect(cols).toContain("snoozedUntil");
    expect(cols).toContain("neverAgain");
  });

  it("recommendations keeps the legacy dismissed boolean column", () => {
    // Task 13 repurposes `dismissed` as a hard soft-delete; it must NOT be
    // removed by this migration. Guard against accidental drop.
    const cols = Object.keys(getTableColumns(schema.recommendations));
    expect(cols).toContain("dismissed");
  });
});
