import { describe, expect, it, vi } from "vitest";

// candidate-pool.ts eagerly imports @/lib/db (postgres-js client throws
// under Vitest); mirror the repo convention (tests/unit/candidate-pool-
// prefilter.test.ts) — mock @/lib/db, then dynamic-import the module.
// This stub only needs to let the module LOAD; this test never calls
// candidatePool (behavioral coverage is Task 12's integration test), so
// the fuller chainable mock in the prefilter test isn't required here.
vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

const { candidatePool } = await import("@/lib/recs/candidate-pool");

describe("candidatePool v2 surface", () => {
  it("is callable and accepts the v2 opts shape (default size 100, optional seed)", () => {
    // Behavioral default-size + seed tests need a DB fixture — covered by
    // the Task 12 integration test. Here: type-surface + smoke only.
    expect(typeof candidatePool).toBe("function");
  });
});
