import { describe, expect, it } from "vitest";
import { SCENE_CATALOG, filterScenes, getScene } from "@/lib/recaps/scenes";

describe("scene catalog", () => {
  it("contains 11 entries", () => {
    expect(SCENE_CATALOG).toHaveLength(11);
  });
  it("yearly mode returns all 11", () => {
    expect(filterScenes(SCENE_CATALOG, "yearly")).toHaveLength(11);
  });
  it("monthly mode filters yearOnly scenes (surprise, taste_evolution, reviews)", () => {
    // yearOnly scenes per plan code + spec: surprise, taste_evolution, reviews
    // Catalog has 11 entries, 3 are yearOnly → monthly = 8.
    // (Spec line 315 says "7 monthly" but the explicit per-scene table at lines
    //  286-298 lists 8 monthly entries; we honor the catalog code as authority.)
    const monthly = filterScenes(SCENE_CATALOG, "monthly");
    expect(monthly).toHaveLength(8);
    const ids = monthly.map((s) => s.id);
    expect(ids).not.toContain("surprise");
    expect(ids).not.toContain("taste_evolution");
    expect(ids).not.toContain("reviews");
  });
  it("AI-tagged scenes are exactly 7 in yearly mode", () => {
    const ai = filterScenes(SCENE_CATALOG, "yearly").filter((s) => s.aiCaption);
    expect(ai).toHaveLength(7);
  });
  it("getScene returns the entry by id", () => {
    expect(getScene("opening")?.id).toBe("opening");
    expect(getScene("closing")?.id).toBe("closing");
  });
});
