import { type Card, SUITS, type StandardCard, cardPoints, isWild } from './cards';
import { MAX_RUN_POSITION, type Meld, type MeldSpec, extendMeld } from './melds';
import { type Requirement, stepRequirements } from './steps';

/**
 * Meld finder: given a hand, enumerate ways to form melds. Used by AI players
 * and (later) UI hints. Everything here is pure and works on cards only.
 */

const byPointsDesc = (a: Card, b: Card) => cardPoints(b) - cardPoints(a);
const wildsIn = (hand: readonly Card[]) => hand.filter(isWild).sort(byPointsDesc);
const naturalsIn = (hand: readonly Card[]) =>
  hand.filter((c): c is StandardCard => c.kind === 'standard' && c.rank !== 2);

function groupByRank(cards: StandardCard[]): Map<number, StandardCard[]> {
  const map = new Map<number, StandardCard[]>();
  for (const c of cards) map.set(c.rank, [...(map.get(c.rank) ?? []), c]);
  return map;
}

export const wildCount = (spec: MeldSpec, hand: readonly Card[]): number => {
  const byId = new Map(hand.map((c) => [c.id, c]));
  return spec.cardIds.filter((id) => {
    const c = byId.get(id);
    return c && isWild(c);
  }).length;
};

/**
 * A meld the hand could form, before any particular cards are chosen.
 *
 * `?` in cardIds marks a place a wild goes. Every other entry is a natural
 * card's *kind* (like "5:H"), not a specific card, because with two decks you
 * can hold two identical cards. Keeping both abstract lets several melds share
 * the hand's wilds and duplicates without each claiming the same actual card;
 * real cards are handed out once the melds are chosen.
 */
interface Candidate {
  spec: MeldSpec;
  wilds: number;
}

const WILD = '?';
const kind = (c: StandardCard) => `${c.rank}:${c.suit}`;

/** The actual cards in hand of each kind, in a stable order. */
function copiesOf(hand: readonly Card[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of naturalsIn(hand)) map.set(kind(c), [...(map.get(kind(c)) ?? []), c.id]);
  return map;
}

/** Give each place in a candidate a real card: wilds from `wilds` (from index `from`), naturals from `copies`. */
function fillCards(
  spec: MeldSpec,
  wilds: Card[],
  copies: Map<string, string[]>,
  from = 0,
): { spec: MeldSpec; next: number } {
  let next = from;
  const cardIds = spec.cardIds.map((id) => (id === WILD ? (wilds[next++] as Card).id : (copies.get(id)?.shift() as string)));
  return { spec: { ...spec, cardIds } as MeldSpec, next };
}

function mostCommonRank(hand: readonly Card[]): number {
  const groups = groupByRank(naturalsIn(hand));
  let best = 13;
  let bestCount = 0;
  for (const [rank, cs] of groups) if (cs.length > bestCount) [best, bestCount] = [rank, cs.length];
  return best;
}

/** Every way to choose `m` cards from a group, skipping choices that only swap identical cards. */
function choose(cards: StandardCard[], m: number): StandardCard[][] {
  const out: StandardCard[][] = [];
  const seen = new Set<string>();
  const go = (from: number, picked: StandardCard[]) => {
    if (picked.length === m) {
      const key = picked.map(kind).sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        out.push(picked);
      }
      return;
    }
    for (let i = from; i < cards.length; i++) go(i + 1, [...picked, cards[i] as StandardCard]);
  };
  go(0, []);
  return out;
}

/** Candidate sets of `size` cards. `wildLimit` caps the wilds a candidate may use (Infinity: no cap). */
function setCandidates(hand: readonly Card[], size: number, wildLimit: number): Candidate[] {
  const out: Candidate[] = [];
  for (const [rank, cs] of groupByRank(naturalsIn(hand))) {
    for (let m = Math.min(cs.length, size); m >= 1; m--) {
      const w = size - m;
      if (w > wildLimit) break;
      for (const picked of choose(cs, m)) {
        out.push({ wilds: w, spec: { kind: 'set', rank, cardIds: [...picked.map(kind), ...Array<string>(w).fill(WILD)] } });
      }
    }
  }
  // A set made only of wilds, named as the rank the hand holds most of.
  if (size <= wildLimit) {
    out.push({ wilds: size, spec: { kind: 'set', rank: mostCommonRank(hand), cardIds: Array<string>(size).fill(WILD) } });
  }
  return out;
}

/** Candidate runs of `size` cards. `wildLimit` caps the wilds a candidate may use. */
function runCandidates(hand: readonly Card[], size: number, wildLimit: number): Candidate[] {
  const nat = naturalsIn(hand);
  const bySuit = SUITS.map((suit) => ({ suit, cards: nat.filter((c) => c.suit === suit) }));
  const out: Candidate[] = [];
  for (const { suit, cards: ofSuit } of bySuit) {
    for (let start = 1; start + size - 1 <= MAX_RUN_POSITION; start++) {
      const ids: string[] = [];
      let w = 0;
      let naturals = 0;
      for (let pos = start; pos < start + size; pos++) {
        const natural = ofSuit.find((c) => c.rank === pos || (c.rank === 1 && pos === 14));
        if (natural) {
          ids.push(kind(natural));
          naturals++;
        } else {
          ids.push(WILD);
          w++;
        }
      }
      if (naturals > 0 && w <= wildLimit) out.push({ wilds: w, spec: { kind: 'run', suit, start, cardIds: ids } });
    }
  }
  // A run made only of wilds, in the suit the hand holds most of.
  if (size <= wildLimit && size <= MAX_RUN_POSITION - 2) {
    const suit = [...bySuit].sort((a, b) => b.cards.length - a.cards.length)[0]?.suit ?? 'S';
    out.push({ wilds: size, spec: { kind: 'run', suit, start: 3, cardIds: Array<string>(size).fill(WILD) } });
  }
  return out;
}

/** Sets of exactly `size` cards (naturals plus as few wilds as needed). */
export function setsOfSize(hand: readonly Card[], size: number): MeldSpec[] {
  const pool = wildsIn(hand);
  return setCandidates(hand, size, pool.length).map((c) => fillCards(c.spec, pool, copiesOf(hand)).spec);
}

/** Runs of exactly `size` cards, filling gaps with wilds. At most `maxWilds` wilds. */
export function runsOfSize(hand: readonly Card[], size: number, maxWilds = Infinity): MeldSpec[] {
  const pool = wildsIn(hand);
  return runCandidates(hand, size, Math.min(maxWilds, pool.length)).map((c) => fillCards(c.spec, pool, copiesOf(hand)).spec);
}

/** Up to `count` disjoint pairs. A set of four makes two pairs; wilds pair with singles. */
export function findPairs(hand: readonly Card[], count: number): MeldSpec[] | null {
  const wilds = wildsIn(hand);
  const pairs: MeldSpec[] = [];
  const singles: StandardCard[] = [];
  for (const [rank, cs] of groupByRank(naturalsIn(hand))) {
    for (let i = 0; i + 1 < cs.length; i += 2) {
      pairs.push({ kind: 'pair', rank, cardIds: [(cs[i] as Card).id, (cs[i + 1] as Card).id] });
    }
    if (cs.length % 2 === 1) singles.push(cs[cs.length - 1] as StandardCard);
  }
  singles.sort(byPointsDesc);
  let w = 0;
  for (const s of singles) {
    if (pairs.length >= count || w >= wilds.length) break;
    pairs.push({ kind: 'pair', rank: s.rank, cardIds: [s.id, (wilds[w++] as Card).id] });
  }
  while (pairs.length < count && w + 1 < wilds.length) {
    const a = wilds[w++] as Card;
    const b = wilds[w++] as Card;
    pairs.push({ kind: 'pair', rank: a.kind === 'standard' ? 2 : 1, cardIds: [a.id, b.id] });
  }
  return pairs.length >= count ? pairs.slice(0, count) : null;
}

/**
 * The cheapest way to make a step's base (fewest wilds), allowing at most
 * `wildLimit` wilds. Shared by `findBase` and `baseDistance` so they always agree.
 */
function searchBase(hand: readonly Card[], step: number, wildLimit: number): { wilds: number; chosen: Candidate[] } | null {
  const reqs = [...stepRequirements(step)].sort((a, b) => b.size - a.size);
  const pools = reqs.map((r) =>
    (r.kind === 'set' ? setCandidates(hand, r.size, wildLimit) : runCandidates(hand, r.size, wildLimit)).sort((a, b) => a.wilds - b.wilds),
  );
  const copies = copiesOf(hand);
  const best = { wilds: Infinity, chosen: null as Candidate[] | null };
  const used = new Map<string, number>();

  const dfs = (i: number, chosen: Candidate[], wilds: number) => {
    if (wilds >= best.wilds || wilds > wildLimit) return;
    if (i === reqs.length) {
      best.wilds = wilds;
      best.chosen = chosen;
      return;
    }
    for (const cand of pools[i] as Candidate[]) {
      const need = new Map<string, number>();
      for (const id of cand.spec.cardIds) if (id !== WILD) need.set(id, (need.get(id) ?? 0) + 1);
      // Do we hold enough copies of each card left over from the melds chosen so far?
      let fine = true;
      for (const [k, n] of need) if ((used.get(k) ?? 0) + n > (copies.get(k)?.length ?? 0)) fine = false;
      if (!fine) continue;
      for (const [k, n] of need) used.set(k, (used.get(k) ?? 0) + n);
      dfs(i + 1, [...chosen, cand], wilds + cand.wilds);
      for (const [k, n] of need) used.set(k, (used.get(k) ?? 0) - n);
    }
  };
  dfs(0, [], 0);
  return best.chosen ? { wilds: best.wilds, chosen: best.chosen } : null;
}

/** Find melds that satisfy a step's base requirement, using the fewest wilds. */
export function findBase(hand: readonly Card[], step: number): MeldSpec[] | null {
  const reqs = stepRequirements(step);
  if (reqs.every((r) => r.kind === 'pair')) return findPairs(hand, reqs.length);
  const wildPool = wildsIn(hand);
  const found = searchBase(hand, step, wildPool.length);
  if (!found) return null;
  // Hand out real cards now that the melds are settled.
  const copies = copiesOf(hand);
  let next = 0;
  return found.chosen.map((c) => {
    const filled = fillCards(c.spec, wildPool, copies, next);
    next = filled.next;
    return filled.spec;
  });
}

/** Candidate extra melds (sets and runs of 3+) from a hand, for use after the base. */
export function extraMelds(hand: readonly Card[]): MeldSpec[] {
  const out: MeldSpec[] = [];
  const wilds = wildsIn(hand);
  for (const [rank, cs] of groupByRank(naturalsIn(hand))) {
    const w = Math.max(0, 3 - cs.length);
    if (w <= wilds.length) {
      out.push({ kind: 'set', rank, cardIds: [...cs, ...wilds.slice(0, w)].map((c) => c.id) });
    }
  }
  for (let size = 3; size <= MAX_RUN_POSITION; size++) out.push(...runsOfSize(hand, size, 2));
  return out;
}

/** How a single card can be added to a table meld, if at all. */
export function buildSides(meld: Meld, card: Card): ('low' | 'high' | undefined)[] {
  if (meld.kind !== 'run') return extendMeld(meld, [card]).ok ? [undefined] : [];
  return (['high', 'low'] as const).filter((side) => extendMeld(meld, [card], side).ok);
}

/** How many pairs this hand can form (a set of four is two pairs; wilds pair with singles). */
export function pairCapacity(hand: readonly Card[]): number {
  let wilds = wildsIn(hand).length;
  let pairs = 0;
  let singles = 0;
  for (const cs of groupByRank(naturalsIn(hand)).values()) {
    pairs += Math.floor(cs.length / 2);
    singles += cs.length % 2;
  }
  const withSingles = Math.min(singles, wilds);
  pairs += withSingles;
  wilds -= withSingles;
  return pairs + Math.floor(wilds / 2);
}

/**
 * Fewest more cards needed to complete a step's base from this hand (0 means
 * the base can be laid now). Wilds in hand fill gaps. Uses the same search as
 * `findBase`, so the two always agree.
 */
export function baseDistance(hand: readonly Card[], step: number): number {
  const reqs = stepRequirements(step);
  if (reqs.every((r) => r.kind === 'pair')) return Math.max(0, reqs.length - pairCapacity(hand));
  // Pretend wilds are unlimited, find the fewest the base would need, and count how many we lack.
  const found = searchBase(hand, step, Infinity);
  return found ? Math.max(0, found.wilds - wildsIn(hand).length) : reqs.reduce((n, r) => n + r.size, 0);
}
