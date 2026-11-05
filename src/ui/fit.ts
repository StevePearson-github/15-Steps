import { isCompact } from './compact';

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

/** Growing the cards must not push the page itself past the window (the bottom row would fall off). */
const pageOverflows = (): boolean => document.documentElement.scrollHeight > window.innerHeight + 1;

/** If overlapping is not enough, the cards in the melds shrink a little (never below about two thirds), loosest first. */
const SCALES = [1, 0.9, 0.8, 0.7, 0.62, 0.56];

/** On a phone held sideways (compact.ts) the melds never shrink below this: smaller than that the cards can't be read, so the melds area scrolls instead. */
const COMPACT_SCALES = [1, 0.9, 0.8, 0.72];

/** Before shrinking the cards another step, the space between melds (and between the owners' groups) tightens: much less visible, and often just enough to keep everything on one row. */
const GAPS = [1, 0.4];

/** Only when the melds are still too many after all that: every card on the table gets a little smaller (the same factor for all of them), so the middle has more room. */
const GROW_KS = [1.3, 1.25, 1.2, 1.15, 1.1, 1.05];
const TABLE_KS = [1, 0.92, 0.85, 0.78];

/** A step's description that would be cut off ("Step 6: two sets of 3 + o…") gets a smaller font until it fits, down to about two thirds. */
function fitStepText(): void {
  for (const pill of document.querySelectorAll<HTMLElement>('.step-pill')) {
    const text = pill.querySelector<HTMLElement>('.step-text');
    if (!text) continue;
    for (let k = 1; k >= 0.64; k -= 0.04) {
      pill.style.setProperty('--pill-k', String(Math.round(k * 100) / 100));
      if (text.scrollWidth <= text.clientWidth + 1) break;
    }
  }
}

export function fitToWindow(): void {
  fitStepText();
  const root = document.documentElement.style;
  const compact = isCompact();
  const scales = compact ? COMPACT_SCALES : SCALES;
  const tries: [number, number, number][] = [];
  for (const scale of scales) for (const gap of GAPS) for (const overlap of OVERLAPS.slice(0, 4)) tries.push([scale, overlap, gap]);
  // As a last resort, overlap the smallest cards as far as is still readable.
  for (const overlap of OVERLAPS.slice(4)) tries.push([scales[scales.length - 1] as number, overlap, GAPS[GAPS.length - 1] as number]);
  // A zoomed-out hand frees room, so the cards on the table may grow past normal (never beyond 1 / hand zoom, nor 1.3×),
  // but only while the melds still keep their full size: growing the table is never worth squeezing the melds.
  const handK = Number(root.getPropertyValue('--hand-k')) || 1;
  const grow = handK < 1 && !compact ? GROW_KS.filter((k) => k <= Math.min(1 / handK, 1.3) + 1e-9) : [];
  for (const k of grow) {
    root.setProperty('--table-k', String(k));
    for (const overlap of OVERLAPS.slice(0, 4)) {
      root.setProperty('--meld-overlap', String(-overlap));
      root.setProperty('--meld-scale', '1');
      root.setProperty('--meld-gap-k', '1');
      if (!overflows() && !pageOverflows()) return;
    }
  }
  // (On a phone the whole table never shrinks: what doesn't fit scrolls.)
  for (const k of compact ? [1] : TABLE_KS) {
    root.setProperty('--table-k', String(k));
    for (const [scale, overlap, gap] of tries) {
      root.setProperty('--meld-overlap', String(-overlap));
      root.setProperty('--meld-scale', String(scale));
      root.setProperty('--meld-gap-k', String(gap));
      if (!overflows()) return;
    }
  }
}

/** Back to the normal size and spacing (the table is going away). */
export function resetFit(): void {
  document.documentElement.style.removeProperty('--meld-overlap');
  document.documentElement.style.removeProperty('--meld-scale');
  document.documentElement.style.removeProperty('--meld-gap-k');
  document.documentElement.style.removeProperty('--table-k');
  document.documentElement.style.removeProperty('--hand-k');
}
