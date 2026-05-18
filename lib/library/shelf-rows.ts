/**
 * Pure layout math for the decorative library shelf.
 *
 * Kept dependency-free (no db / server-only / React) so the rule is
 * unit-testable in isolation — importing the shelf component pulls the
 * whole client+server graph.
 *
 * The profile shows a *capped preview* of the library on a wooden shelf
 * whose rows are split into planks at a responsive column count. A ragged
 * final plank (e.g. 24 fetched, 7 cols → a full row of 7 then a
 * half-empty 5) reads as broken. For a capped preview we therefore render
 * only whole rows and let the existing "See all →" link cover the rest.
 *
 * @param total   number of items available to the shelf
 * @param cols    active responsive column count (always ≥ 1 in practice)
 * @param maxRows row cap for a preview; `undefined` = uncapped (the
 *                full-library callsites must render everything unchanged)
 * @returns how many of `total` to actually render
 */
export function shelfVisibleCount(
  total: number,
  cols: number,
  maxRows: number | undefined,
): number {
  if (total <= 0) return 0;
  // Uncapped (full library page / view switcher): render everything,
  // ragged tail and all — that's the user's complete collection, not a
  // truncation artifact.
  if (maxRows === undefined) return total;
  if (cols <= 0) return total;

  const fullRows = Math.floor(total / cols);
  // Fewer than one full row: this IS their whole (tiny) library, so a
  // single short row is honest — not the ragged-truncation artifact we
  // trim. Show all of it.
  if (fullRows < 1) return total;
  // Otherwise show only complete rows, capped at maxRows.
  return Math.min(fullRows, maxRows) * cols;
}
