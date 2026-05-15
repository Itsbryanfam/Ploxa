import { describe, expect, it } from "vitest";
import { SCENE_CATALOG, filterScenes, getScene } from "@/lib/recaps/scenes";

describe("scene catalog", () => {
  // T14 added 4 substitute-scene catalog entries (most_replayed, top_theme,
  // completion_ratio, mood_themes) on top of the 11 primary scenes, bringing
  // the total to 15. Substitute scenes carry `isSubstitute: true` and are
  // excluded from `filterScenes`'s output so they never appear in the base
  // scene list — they only enter `payload.scenes` via `applySubstitutions`.
  it("contains 15 entries (11 primary + 4 substitute)", () => {
    expect(SCENE_CATALOG).toHaveLength(15);
  });
  it("yearly mode returns 11 primary scenes (substitutes excluded)", () => {
    const yearly = filterScenes(SCENE_CATALOG, "yearly");
    expect(yearly).toHaveLength(11);
    const ids = yearly.map((s) => s.id);
    // Substitutes never appear in the base list.
    expect(ids).not.toContain("most_replayed");
    expect(ids).not.toContain("top_theme");
    expect(ids).not.toContain("completion_ratio");
    expect(ids).not.toContain("mood_themes");
  });
  it("monthly mode filters yearOnly scenes (surprise, taste_evolution, reviews)", () => {
    // Primary monthly = 11 primaries − 3 yearOnly primaries = 8.
    const monthly = filterScenes(SCENE_CATALOG, "monthly");
    expect(monthly).toHaveLength(8);
    const ids = monthly.map((s) => s.id);
    expect(ids).not.toContain("surprise");
    expect(ids).not.toContain("taste_evolution");
    expect(ids).not.toContain("reviews");
    // Substitutes still excluded in monthly too.
    expect(ids).not.toContain("most_replayed");
    expect(ids).not.toContain("top_theme");
  });
  it("AI-tagged scenes are exactly 7 in yearly mode", () => {
    // Substitute scenes are aiCaption: false, so the AI-tagged count stays
    // at the original 7 (opening, goty, genre_dominance, mechanic_love,
    // surprise, taste_evolution, closing).
    const ai = filterScenes(SCENE_CATALOG, "yearly").filter((s) => s.aiCaption);
    expect(ai).toHaveLength(7);
  });
  it("getScene returns the entry by id", () => {
    expect(getScene("opening")?.id).toBe("opening");
    expect(getScene("closing")?.id).toBe("closing");
  });
  it("getScene resolves substitute scene ids (lookup-only, never in base list)", () => {
    expect(getScene("most_replayed")?.id).toBe("most_replayed");
    expect(getScene("top_theme")?.id).toBe("top_theme");
    expect(getScene("completion_ratio")?.id).toBe("completion_ratio");
    expect(getScene("mood_themes")?.id).toBe("mood_themes");
  });
});
