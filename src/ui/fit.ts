/**
 * Keep the whole table on screen without ever changing a card's size.
 *
 * Cards stay one fixed size all game. When the melds on the table would not fit in the middle of the screen, the cards in
 * each meld overlap more (`--meld-overlap`), so more melds fit in a row and fewer rows are needed. It tries the
 * loosest spacing that fits, from the same starting point every time, so the same table always looks the same.
 */

/** How much of a meld card is covered by the next one, loosest first. A card's rank and suit sit in its top-left corner, so it stays readable up to about three quarters. */
const OVERLAPS = [0.46, 0.54, 0.62, 0.68, 0.72, 0.75];

/** The window itself never scrolls; the melds area does if it must, so that is what we measure. */
const overflows = (): boolean => {
  const melds = document.querySelector<HTMLElement>('.melds');
  return !!melds && melds.scrollHeight > melds.clientHeight + 1;
};

/** If overlapping is not enough, the cards in the melds shrink a little (never below about two thirds), loosest first. */
const SCALES = [1, 0.9, 0.8, 0.7, 0.62];

export function fitToWindow(): void {
  const root = document.documentElement.style;
  const tries: [number, number][] = [];
  for (const scale of SCALES) for (const overlap of OVERLAPS.slice(0, 4)) tries.push([scale, overlap]);
  // As a last resort, overlap the smallest cards as far as is still readable.
  for (const overlap of OVERLAPS.slice(4)) tries.push([SCALES[SCALES.length - 1] as number, overlap]);
  for (const [scale, overlap] of tries) {
    root.setProperty('--meld-overlap', String(-overlap));
    root.setProperty('--meld-scale', String(scale));
    if (!overflows()) return;
  }
}

/** Back to the normal size and spacing (the table is going away). */
export function resetFit(): void {
  document.documentElement.style.removeProperty('--meld-overlap');
  document.documentElement.style.removeProperty('--meld-scale');
}
