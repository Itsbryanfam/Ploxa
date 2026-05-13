// materialEventFromMutation lives in a pure (non-"use server") module so it
// can be imported directly without any database / env setup.
import { describe, expect, it } from "vitest";
import { materialEventFromMutation } from "@/lib/logs/material-event";

describe("materialEventFromMutation — truth table", () => {
  // -------------------------------------------------------------------------
  // Status transitions → material (status_change)
  // -------------------------------------------------------------------------
  it("backlog → playing is material (status_change)", () => {
    const result = materialEventFromMutation({
      prevStatus: "backlog",
      newStatus: "playing",
      prevRating: null,
      newRating: null,
    });
    expect(result).toEqual({ eventType: "status_change" });
  });

  it("backlog → completed is material (status_change)", () => {
    const result = materialEventFromMutation({
      prevStatus: "backlog",
      newStatus: "completed",
      prevRating: null,
      newRating: null,
    });
    expect(result).toEqual({ eventType: "status_change" });
  });

  it("playing → completed is material (status_change)", () => {
    const result = materialEventFromMutation({
      prevStatus: "playing",
      newStatus: "completed",
      prevRating: null,
      newRating: null,
    });
    expect(result).toEqual({ eventType: "status_change" });
  });

  it("playing → on_hold is material (status_change)", () => {
    const result = materialEventFromMutation({
      prevStatus: "playing",
      newStatus: "on_hold",
      prevRating: null,
      newRating: null,
    });
    expect(result).toEqual({ eventType: "status_change" });
  });

  it("completed → dropped is material (status_change)", () => {
    const result = materialEventFromMutation({
      prevStatus: "completed",
      newStatus: "dropped",
      prevRating: null,
      newRating: null,
    });
    expect(result).toEqual({ eventType: "status_change" });
  });

  it("on_hold → playing is material (status_change)", () => {
    const result = materialEventFromMutation({
      prevStatus: "on_hold",
      newStatus: "playing",
      prevRating: null,
      newRating: null,
    });
    expect(result).toEqual({ eventType: "status_change" });
  });

  it("null → playing IS material (fresh log direct to playing)", () => {
    expect(materialEventFromMutation({
      prevStatus: null, newStatus: "playing", prevRating: null, newRating: null,
    })?.eventType).toBe("status_change");
  });

  // -------------------------------------------------------------------------
  // Status transitions → NOT material (non-material targets)
  // -------------------------------------------------------------------------
  it("null → backlog is NOT material (fresh import / wishlist add)", () => {
    const result = materialEventFromMutation({
      prevStatus: null,
      newStatus: "backlog",
      prevRating: null,
      newRating: null,
    });
    expect(result).toBeNull();
  });

  it("null → wishlist is NOT material", () => {
    const result = materialEventFromMutation({
      prevStatus: null,
      newStatus: "wishlist",
      prevRating: null,
      newRating: null,
    });
    expect(result).toBeNull();
  });

  it("playing → backlog (demotion to non-material target) is NOT material", () => {
    const result = materialEventFromMutation({
      prevStatus: "playing",
      newStatus: "backlog",
      prevRating: null,
      newRating: null,
    });
    expect(result).toBeNull();
  });

  it("wishlist → backlog (non-material → non-material) is NOT material", () => {
    const result = materialEventFromMutation({
      prevStatus: "wishlist",
      newStatus: "backlog",
      prevRating: null,
      newRating: null,
    });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Same-status no-op
  // -------------------------------------------------------------------------
  it("playing → playing (no-op) is NOT material", () => {
    const result = materialEventFromMutation({
      prevStatus: "playing",
      newStatus: "playing",
      prevRating: null,
      newRating: null,
    });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Rating events
  // -------------------------------------------------------------------------
  it("null → 8 (rating set for first time) is material (rating_set)", () => {
    const result = materialEventFromMutation({
      prevStatus: "completed",
      newStatus: "completed",
      prevRating: null,
      newRating: 8,
    });
    expect(result).toEqual({ eventType: "rating_set" });
  });

  it("8 → 9 (rating changed) is material (rating_set)", () => {
    const result = materialEventFromMutation({
      prevStatus: "completed",
      newStatus: "completed",
      prevRating: 8,
      newRating: 9,
    });
    expect(result).toEqual({ eventType: "rating_set" });
  });

  it("8 → null (rating cleared) is NOT material", () => {
    const result = materialEventFromMutation({
      prevStatus: "completed",
      newStatus: "completed",
      prevRating: 8,
      newRating: null,
    });
    expect(result).toBeNull();
  });

  it("8 → 8 (same rating, no change) is NOT material", () => {
    const result = materialEventFromMutation({
      prevStatus: "completed",
      newStatus: "completed",
      prevRating: 8,
      newRating: 8,
    });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Combo: status_change wins over rating_set
  // -------------------------------------------------------------------------
  it("backlog → completed WITH rating 9 in same mutation returns status_change (not rating_set)", () => {
    const result = materialEventFromMutation({
      prevStatus: "backlog",
      newStatus: "completed",
      prevRating: null,
      newRating: 9,
    });
    // status_change is the bigger signal and evaluated first
    expect(result).toEqual({ eventType: "status_change" });
  });
});
