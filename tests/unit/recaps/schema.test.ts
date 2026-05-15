import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

describe("Phase 6 schema additions", () => {
  it("exports monthlyRecaps table", () => {
    expect(schema.monthlyRecaps).toBeDefined();
  });
  it("exports featuredLists table", () => {
    expect(schema.featuredLists).toBeDefined();
  });
  it("yearInReviews has shareImageHash + lockedAt columns", () => {
    const cols = Object.keys(getTableColumns(schema.yearInReviews));
    expect(cols).toContain("shareImageHash");
    expect(cols).toContain("lockedAt");
  });
  it("profiles has lastRecapSentAt column", () => {
    const cols = Object.keys(getTableColumns(schema.profiles));
    expect(cols).toContain("lastRecapSentAt");
  });
});
