import "server-only";

/**
 * Rule-based auto-flag for comments. Pure function — no IO, no AI call,
 * <1ms per check. Flagged comments are routed to the mod queue via the
 * createComment server action (T14) which INSERTs a report row with
 * status='auto_flagged' alongside the comment.
 *
 * Not auto-deleted — only auto-hidden until a human reviews. Author still
 * sees their own flagged comment with a "pending review" badge.
 *
 * Spec rationale: AI moderation has false-positive risk on legitimately
 * harsh game reviews ("this game is awful" is a valid reaction).
 * Rules-only matches plan's "simple auto-flag" intent.
 */

const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const REPEAT_RE = /(.)\1{6,}/;
const ALL_CAPS_BODY_MIN_LENGTH = 30;
const ALL_CAPS_RATIO_THRESHOLD = 0.7;
const URL_COUNT_THRESHOLD = 3;

// Tiny starter blocklist; extend as we see real spam patterns in beta.
// Lowercased; checked case-insensitively against the body.
const BLOCKLIST = new Set<string>([
  "free v-bucks",
  "click here for",
  "buy followers",
  "100% working",
  "make money fast",
  "limited time offer",
  "discord.gg/free",
]);

export type SpamCheckResult = { isFlagged: boolean; reasons: string[] };

export function checkSpamRules(body: string): SpamCheckResult {
  const reasons: string[] = [];

  // Rule 1: link density.
  const urlCount = (body.match(URL_RE) ?? []).length;
  if (urlCount >= URL_COUNT_THRESHOLD) {
    reasons.push("link_density");
  }

  // Rule 2: all-caps (only for non-trivial body length).
  if (body.length >= ALL_CAPS_BODY_MIN_LENGTH) {
    const letters = body.replace(/[^A-Za-z]/g, "");
    if (letters.length > 0) {
      const capsCount = (body.match(/[A-Z]/g) ?? []).length;
      if (capsCount / letters.length > ALL_CAPS_RATIO_THRESHOLD) {
        reasons.push("all_caps");
      }
    }
  }

  // Rule 3: repeat character runs.
  if (REPEAT_RE.test(body)) {
    reasons.push("repeat_chars");
  }

  // Rule 4: blocklist phrases (case-insensitive substring match).
  const lower = body.toLowerCase();
  for (const phrase of BLOCKLIST) {
    if (lower.includes(phrase)) {
      reasons.push("blocklist");
      break; // one blocklist hit is enough; no need to enumerate all
    }
  }

  return { isFlagged: reasons.length > 0, reasons };
}
