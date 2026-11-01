/**
 * Keep the whole table on screen without ever changing a card's size.
 *
 * Cards stay one fixed size all game. When the melds on the table would not fit in the middle of the screen, the cards in
 * each meld overlap more (`--meld-overlap`), so more melds fit in a row and fewer rows are needed. It tries the
 * loosest spacing that fits, from the same starting point every time, so the same table always looks the same.
 */

/** How much of a meld card is covered by the next one, loosest first. A card's rank and suit sit in its top-left corner, so it stays readable up to about three quarters. */
const OVERLAPS = [0.46, 0.54, 0.62, 0.68, 0.72, 0.75];

/** The window itself never scrolls; the middle area (the melds) does if it must, so that is what we measure. */
const overflows = (): boolean => {
  const middle = document.querySelector<HTMLElement>('.center');
  return !!middle && middle.scrollHeight > middle.clientHeight + 1;
};

export function fitToWindow(): void {
  const root = document.documentElement.style;
  for (const overlap of OVERLAPS) {
    root.setProperty('--meld-overlap', String(-overlap));
    if (!overflows()) return;
  }
}

/** Back to the normal spacing (the table is going away). */
export function resetFit(): void {
  document.documentElement.style.removeProperty('--meld-overlap');
}
