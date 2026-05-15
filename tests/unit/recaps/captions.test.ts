import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * captions.test.ts — Phase 6 T6 unit tests.
 *
 * The router surface this module wraps is `generate({prompt, systemPrompt,
 * feature, userId, ...})` returning `{textStream, providerUsed}` (NOT the
 * `generateObject` the plan described — the plan was outdated). The captions
 * module consumes the textStream, JSON-parses, and zod-validates. We mock
 * the router here to short-circuit that work in tests:
 *
 *   - Success path: textStream yields valid JSON → caption returned.
 *   - Validation failure: textStream yields garbage → captions retries once
 *     with a stricter system suffix. If retry also fails → fallback.
 *   - Provider exhaustion: generate() throws AIProvidersExhaustedError →
 *     fallback (no retry; retrying when no providers are configured is
 *     pointless).
 *
 * `@/lib/db` is mocked so we can assert ai_calls.insert was called the
 * expected number of times per scenario (criterion 4).
 */

vi.mock("@/lib/ai/router", () => ({
  generate: vi.fn(),
}));

vi.mock("@/lib/ai/errors", () => ({
  AIProvidersExhaustedError: class extends Error {
    public readonly attempts: Array<{ provider: string; error: unknown }>;
    constructor(attempts: Array<{ provider: string; error: unknown }> = []) {
      super(`All ${attempts.length} AI providers failed`);
      this.name = "AIProvidersExhaustedError";
      this.attempts = attempts;
    }
  },
  AIRouterError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AIRouterError";
    }
  },
  RateLimitExceededError: class extends Error {
    constructor() {
      super("rate limit");
      this.name = "RateLimitExceededError";
    }
  },
}));

vi.mock("@/lib/db", () => {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  return {
    db: { insert },
    schema: { aiCalls: {} },
  };
});

import { generate } from "@/lib/ai/router";
import { AIProvidersExhaustedError } from "@/lib/ai/errors";
import { db } from "@/lib/db";
import { generateCaption, generateAllCaptions } from "@/lib/recaps/captions";
import { getScene, SCENE_CATALOG } from "@/lib/recaps/scenes";
import type { RecapPayload } from "@/lib/recaps/types";

const mockGenerate = vi.mocked(generate);

/** Helper: build a fake textStream that yields the given chunks. */
function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

/** Helper: build a mock `generate` resolution. */
function mockGenerateSuccess(jsonChunk: string) {
  return Promise.resolve({
    textStream: fakeStream(jsonChunk),
    providerUsed: "cerebras" as const,
  });
}

const samplePayload: RecapPayload = {
  tier: "ok",
  mode: "yearly",
  windowStart: "2026-01-01T00:00:00.000Z",
  windowEnd: "2027-01-01T00:00:00.000Z",
  scenes: ["opening", "stats_total", "goty", "closing"],
  totals: {
    totalGames: 47,
    totalHoursPlayed: 120,
    completedCount: 30,
    droppedCount: 5,
    replayingCount: 2,
    reviewCount: 4,
  },
  topGames: [
    {
      gameId: "g1",
      rawgId: null,
      title: "Game A",
      coverUrl: null,
      rating: 5,
      status: "completed",
    },
  ],
  goty: {
    gameId: "g1",
    rawgId: null,
    title: "Game A",
    coverUrl: null,
    rating: 5,
    status: "completed",
  },
  topGenre: { name: "Action", pct: 40, secondName: "RPG", secondPct: 20 },
  captions: {},
};

beforeEach(() => {
  mockGenerate.mockReset();
  vi.mocked(db.insert).mockClear();
});

describe("generateCaption", () => {
  it("returns AI response on success", async () => {
    mockGenerate.mockReturnValueOnce(
      mockGenerateSuccess(JSON.stringify({ caption: "An action-packed year." })),
    );
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload, "user-1");
    expect(out).toBe("An action-packed year.");
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back to template on AIProvidersExhaustedError (no retry)", async () => {
    mockGenerate.mockRejectedValueOnce(new AIProvidersExhaustedError([]));
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload, "user-1");
    expect(out).toBe(scene.fallbackTemplate(samplePayload));
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("retries once on validation failure, falls back if retry also fails", async () => {
    // Both attempts return JSON that's missing the `caption` key.
    mockGenerate.mockReturnValueOnce(
      mockGenerateSuccess(JSON.stringify({ notcaption: "wrong shape" })),
    );
    mockGenerate.mockReturnValueOnce(
      mockGenerateSuccess(JSON.stringify({ notcaption: "still wrong" })),
    );
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload, "user-1");
    expect(out).toBe(scene.fallbackTemplate(samplePayload));
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("retries once and succeeds on the retry when first attempt is malformed", async () => {
    mockGenerate.mockReturnValueOnce(mockGenerateSuccess("not valid json at all"));
    mockGenerate.mockReturnValueOnce(
      mockGenerateSuccess(JSON.stringify({ caption: "Retry succeeded." })),
    );
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload, "user-1");
    expect(out).toBe("Retry succeeded.");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("non-AI scene returns fallbackTemplate directly (no router call)", async () => {
    const scene = getScene("stats_total")!;
    expect(scene.aiCaption).toBe(false);
    const out = await generateCaption(scene, samplePayload, "user-1");
    expect(out).toBe(scene.fallbackTemplate(samplePayload));
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("writes an ai_calls row when validation fails and falls back", async () => {
    // Two validation failures → captions module should insert a failure row.
    mockGenerate.mockReturnValueOnce(mockGenerateSuccess("garbage"));
    mockGenerate.mockReturnValueOnce(mockGenerateSuccess("more garbage"));
    const scene = getScene("opening")!;
    await generateCaption(scene, samplePayload, "user-1");
    // db.insert should have been invoked at least once for the failure row.
    expect(db.insert).toHaveBeenCalled();
  });

  it("writes an ai_calls row on provider exhaustion fallback", async () => {
    mockGenerate.mockRejectedValueOnce(new AIProvidersExhaustedError([]));
    const scene = getScene("opening")!;
    await generateCaption(scene, samplePayload, "user-1");
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("generateAllCaptions", () => {
  it("parallelizes across scenes in payload.scenes and returns a record", async () => {
    // payload.scenes lists opening, stats_total, goty, closing.
    // AI-tagged: opening, goty, closing (3). Non-AI: stats_total.
    // We expect 3 generate calls. Sequence is preserved by Promise.all but
    // not guaranteed for mock ordering — give every call the same response.
    mockGenerate.mockImplementation(() =>
      mockGenerateSuccess(JSON.stringify({ caption: "AI caption text." })),
    );
    const out = await generateAllCaptions(samplePayload, "user-1");
    expect(Object.keys(out).sort()).toEqual(["closing", "goty", "opening", "stats_total"]);
    expect(out.opening).toBe("AI caption text.");
    expect(out.goty).toBe("AI caption text.");
    expect(out.closing).toBe("AI caption text.");
    // stats_total has aiCaption=false → fallback template.
    const statsScene = getScene("stats_total")!;
    expect(out.stats_total).toBe(statsScene.fallbackTemplate(samplePayload));
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });

  it("includes every scene from payload.scenes even if its prompt cannot be built", async () => {
    // mechanic_love requires payload.topMechanic. Without it, the prompt
    // builder returns null and the scene should fall back to the template.
    const payloadNoMechanic: RecapPayload = {
      ...samplePayload,
      scenes: ["mechanic_love"],
      topMechanic: undefined,
    };
    const out = await generateAllCaptions(payloadNoMechanic, "user-1");
    const scene = getScene("mechanic_love")!;
    expect(out.mechanic_love).toBe(scene.fallbackTemplate(payloadNoMechanic));
    // No router call because prompt builder returned null before generate().
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("only references scenes present in SCENE_CATALOG (no orphan IDs)", async () => {
    // Sanity: every scene id in payload.scenes must resolve to a catalog
    // entry. This guards against a future drift where the aggregator
    // emits a scene id the catalog hasn't shipped yet.
    mockGenerate.mockImplementation(() =>
      mockGenerateSuccess(JSON.stringify({ caption: "x." })),
    );
    const out = await generateAllCaptions(samplePayload, "user-1");
    for (const id of samplePayload.scenes) {
      expect(out).toHaveProperty(id);
      const inCatalog = SCENE_CATALOG.find((s) => s.id === id);
      expect(inCatalog).toBeDefined();
    }
  });
});
