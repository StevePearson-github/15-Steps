import { type Card, SUITS, type Suit, isWild } from './cards';
import { MAX_RUN_POSITION, type MeldSpec, buildMeld } from './melds';

export interface ResolveHint {
  rank?: number;
  suit?: Suit;
  start?: number;
}

/**
 * Work out every valid way to lay these cards down as a meld of the given kind.
 * Players should not have to say what a wild stands for when only one reading
 * is possible: if exactly one spec comes back, use it. Several means the
 * choice is genuinely ambiguous (e.g. three wilds) and the player must pick;
 * a `hint` narrows the options. No specs means the cards cannot form that meld.
 * Readings that treat a 2 as itself come first.
 */
export function resolveMeld(
  kind: 'set' | 'pair' | 'run',
  cards: readonly Card[],
  hint: ResolveHint = {},
): MeldSpec[] {
  const specs = kind === 'run' ? runOptions(cards, hint) : rankOptions(kind, cards, hint);
  return specs.filter((s) => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const ordered = s.cardIds.map((id) => byId.get(id) as Card);
    return buildMeld(s, ordered, 0, 0).ok;
  });
}

function rankOptions(kind: 'set' | 'pair', cards: readonly Card[], hint: ResolveHint): MeldSpec[] {
  const cardIds = cards.map((c) => c.id);
  const naturals = cards.filter((c) => !isWild(c));
  let ranks: number[];
  if (naturals.length > 0) {
    ranks = [(naturals[0] as { rank: number }).rank];
  } else {
    // Only wilds. A 2 played as itself is the first reading; otherwise any rank.
    const twoFirst = cards.some((c) => c.kind === 'standard' && c.rank === 2);
    ranks = [...(twoFirst ? [2] : []), ...Array.from({ length: 13 }, (_, i) => i + 1).filter((r) => r !== 2 || !twoFirst)];
  }
  if (hint.rank !== undefined) ranks = ranks.filter((r) => r === hint.rank);
  return ranks.map((rank) => ({ kind, rank, cardIds }));
}

function runOptions(cards: readonly Card[], hint: ResolveHint): MeldSpec[] {
  const n = cards.length;
  const naturals = cards.filter((c) => !isWild(c)) as Extract<Card, { kind: 'standard' }>[];
  const wilds = cards.filter(isWild);
  const suitOptions: Suit[] =
    naturals.length > 0 ? [naturals[0]!.suit] : hint.suit ? [hint.suit] : [...SUITS];
  const out: MeldSpec[] = [];

  for (const suit of suitOptions) {
    if (hint.suit && hint.suit !== suit) continue;
    for (let start = 1; start + n - 1 <= MAX_RUN_POSITION; start++) {
      if (hint.start !== undefined && hint.start !== start) continue;
      const slots = new Array<Card | null>(n).fill(null);
      if (!placeNaturals(naturals, 0, start, n, slots)) continue;
      const free = [...wilds];
      const cardIds = slots.map((s) => (s ?? (free.shift() as Card)).id);
      out.push({ kind: 'run', suit, start, cardIds });
    }
  }
  // Prefer readings where 2s sit in their own natural place.
  const naturalTwos = (s: MeldSpec) =>
    s.kind === 'run'
      ? cards.filter((c) => c.kind === 'standard' && c.rank === 2 && s.cardIds.indexOf(c.id) + s.start === 2).length
      : 0;
  return out.sort((a, b) => naturalTwos(b) - naturalTwos(a));
}

/** Backtracking assignment of natural cards to run positions (ace is 1 or 14). */
function placeNaturals(
  naturals: readonly Extract<Card, { kind: 'standard' }>[],
  i: number,
  start: number,
  n: number,
  slots: (Card | null)[],
): boolean {
  if (i === naturals.length) return true;
  const card = naturals[i]!;
  const positions = card.rank === 1 ? [1, MAX_RUN_POSITION] : [card.rank];
  for (const pos of positions) {
    const slot = pos - start;
    if (slot < 0 || slot >= n || slots[slot]) continue;
    slots[slot] = card;
    if (placeNaturals(naturals, i + 1, start, n, slots)) return true;
    slots[slot] = null;
  }
  return false;
}
