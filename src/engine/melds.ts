import { type Card, type Suit, SUITS, isWild } from './cards';
import type { Requirement } from './steps';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T = never>(error: string): Result<T> => ({ ok: false, error });

/**
 * A player's description of a meld to lay down. Wilds take whatever rank (set,
 * pair) or position (run) the spec implies, so the player's intent is explicit.
 *
 * Run positions are 1..14 where 1 and 14 are both Ace (low / high). Card i of a
 * run sits at position start + i.
 */
export type MeldSpec =
  | { kind: 'set' | 'pair'; rank: number; cardIds: string[] }
  | { kind: 'run'; suit: Suit; start: number; cardIds: string[] };

export type Meld = { id: number; owner: number } & (
  | { kind: 'set' | 'pair'; rank: number; cards: Card[] }
  | { kind: 'run'; suit: Suit; start: number; cards: Card[] }
);

export const MIN_MELD_SIZE = 3;
export const PAIR_SIZE = 2;
export const MAX_RUN_POSITION = 14;

function fitsRank(card: Card, rank: number): boolean {
  return isWild(card) || (card.kind === 'standard' && card.rank === rank);
}

function fitsPosition(card: Card, suit: Suit, pos: number): boolean {
  if (isWild(card)) return true;
  if (card.kind !== 'standard' || card.suit !== suit) return false;
  return card.rank === pos || (card.rank === 1 && pos === MAX_RUN_POSITION);
}

/** Validate a meld spec against the actual cards (in spec order) and build it. */
export function buildMeld(spec: MeldSpec, cards: Card[], id: number, owner: number): Result<Meld> {
  if (cards.length !== spec.cardIds.length) return err('Card count does not match meld');
  if (spec.kind === 'run') {
    if (!SUITS.includes(spec.suit)) return err('Invalid run suit');
    if (cards.length < MIN_MELD_SIZE) return err('A run needs at least 3 cards');
    if (!Number.isInteger(spec.start) || spec.start < 1) return err('Invalid run start');
    if (spec.start + cards.length - 1 > MAX_RUN_POSITION) return err('Run goes past the ace');
    for (let i = 0; i < cards.length; i++) {
      if (!fitsPosition(cards[i] as Card, spec.suit, spec.start + i)) {
        return err('Card does not fit run: runs must be one suit and consecutive');
      }
    }
    return ok({ id, owner, kind: 'run', suit: spec.suit, start: spec.start, cards });
  }
  if (!Number.isInteger(spec.rank) || spec.rank < 1 || spec.rank > 13) return err('Invalid rank');
  if (spec.kind === 'pair') {
    if (cards.length !== PAIR_SIZE) return err('A pair has exactly 2 cards');
  } else if (cards.length < MIN_MELD_SIZE) {
    return err('A set needs at least 3 cards');
  }
  if (!cards.every((c) => fitsRank(c, spec.rank))) return err('All cards in a set or pair must match');
  return ok({ id, owner, kind: spec.kind, rank: spec.rank, cards });
}

/**
 * Add cards to an existing meld. Runs are extended outward from one end
 * ('low' goes down from the start, 'high' goes up from the end); the first card
 * given is adjacent to the existing run. A pair that gains a card becomes a set.
 */
export function extendMeld(meld: Meld, cards: Card[], side?: 'low' | 'high'): Result<Meld> {
  if (cards.length === 0) return err('No cards to add');
  if (meld.kind !== 'run') {
    if (!cards.every((c) => fitsRank(c, meld.rank))) return err('Cards do not match the set');
    const all = [...meld.cards, ...cards];
    return ok({ ...meld, kind: all.length >= MIN_MELD_SIZE ? 'set' : 'pair', cards: all });
  }
  if (side !== 'low' && side !== 'high') return err('Choose which end of the run to extend');
  if (side === 'high') {
    const first = meld.start + meld.cards.length;
    if (first + cards.length - 1 > MAX_RUN_POSITION) return err('Run goes past the ace');
    for (let i = 0; i < cards.length; i++) {
      if (!fitsPosition(cards[i] as Card, meld.suit, first + i)) return err('Card does not extend the run');
    }
    return ok({ ...meld, cards: [...meld.cards, ...cards] });
  }
  const newStart = meld.start - cards.length;
  if (newStart < 1) return err('Run goes below the ace');
  for (let i = 0; i < cards.length; i++) {
    if (!fitsPosition(cards[i] as Card, meld.suit, meld.start - 1 - i)) return err('Card does not extend the run');
  }
  return ok({ ...meld, start: newStart, cards: [...cards].reverse().concat(meld.cards) });
}

/** Do these melds exactly satisfy the step's base requirements? */
export function meldsSatisfy(melds: readonly Meld[], reqs: readonly Requirement[]): boolean {
  if (melds.length !== reqs.length) return false;
  const used = new Array<boolean>(melds.length).fill(false);
  const ordered = [...reqs].sort((a, b) => b.size - a.size);
  for (const req of ordered) {
    let best = -1;
    melds.forEach((m, i) => {
      if (used[i] || m.kind !== req.kind || m.cards.length < req.size) return;
      if (best === -1 || m.cards.length < (melds[best] as Meld).cards.length) best = i;
    });
    if (best === -1) return false;
    used[best] = true;
  }
  return true;
}
