"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { Mascot } from "@/components/mascot/mascot";

/**
 * Recency window for the first-fingerprint celebration toast. If the
 * narrative is older than this, the user already saw the page after generation
 * and we skip the toast (e.g. they navigated away and back hours later).
 *
 * The 5-minute window is generous enough that the cron-triggered refresh that
 * happens behind the scenes after the 10th log will land while the user is
 * still actively on the page, but short enough that we don't bother surfacing
 * a celebration for a narrative the user has clearly already lived with.
 */
const RECENT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * One-time celebration toast: fires once per user the first time they
 * see their AI taste narrative on /me/taste. Mounted only when `isOwner`
 * on the taste page so it never fires for visitors looking at someone
 * else's profile.
 *
 * Gating order (cheapest first → bail early):
 * 1. Narrative + narrativeGeneratedAt must both exist (skip empty/sparse).
 * 2. localStorage flag `firstFingerprintCelebrated:${userId}` must be unset.
 * 3. Narrative must be < 5 minutes old (skip historical visits).
 *
 * Flag write happens immediately after the toast fires so a fast double-mount
 * (Strict Mode, route prefetch) doesn't double-toast. Returns null — no DOM,
 * just a side-effect island.
 */
export function MilestoneToast({
  userId,
  narrative,
  narrativeGeneratedAt,
}: {
  userId: string;
  narrative: string | null;
  narrativeGeneratedAt: Date | null;
}) {
  useEffect(() => {
    if (!narrative || !narrativeGeneratedAt) return;
    const flagKey = `firstFingerprintCelebrated:${userId}`;
    if (localStorage.getItem(flagKey)) return;
    const age = Date.now() - narrativeGeneratedAt.getTime();
    if (age > RECENT_WINDOW_MS) return;

    toast.custom(
      () => (
        <div className="flex items-center gap-3 rounded-md border border-emerald-700 bg-emerald-950/80 px-4 py-3 text-sm">
          <Mascot mood="celebrating" size="sm" silent />
          <span>Your first taste read is ready!</span>
        </div>
      ),
      { duration: 6000 },
    );
    localStorage.setItem(flagKey, String(Date.now()));
  }, [userId, narrative, narrativeGeneratedAt]);

  return null;
}
