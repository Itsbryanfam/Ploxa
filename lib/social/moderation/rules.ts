import "server-only";

/** STUB — full implementation lands in T15. */
export function checkSpamRules(_body: string): { isFlagged: boolean; reasons: string[] } {
  return { isFlagged: false, reasons: [] };
}
