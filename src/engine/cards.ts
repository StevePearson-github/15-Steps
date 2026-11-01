export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

/** Rank 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. */
export interface StandardCard {
  id: string;
  kind: 'standard';
  rank: number;
  suit: Suit;
}

export interface JokerCard {
  id: string;
  kind: 'joker';
}

export type Card = StandardCard | JokerCard;

const RANK_CHARS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

export function rankChar(rank: number): string {
  const c = RANK_CHARS[rank];
  if (!c) throw new Error(`Invalid rank ${rank}`);
  return c;
}

/** Wild cards: jokers and 2s. */
export function isWild(card: Card): boolean {
  return card.kind === 'joker' || card.rank === 2;
}

/** Penalty points for a card left in hand when another player goes out. */
export function cardPoints(card: Card): number {
  if (card.kind === 'joker') return 50;
  if (card.rank === 2) return 20;
  if (card.rank === 1) return 15;
  if (card.rank >= 10) return 10;
  return 5;
}

export function handPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

/**
 * Build an unshuffled deck. Ids look like "5S.1" (rank, suit, deck number)
 * or "X.3" (joker number), and are unique within a deck.
 */
export function createDeck(decks = 2, jokersPerDeck = 2): Card[] {
  const cards: Card[] = [];
  let jokerNo = 1;
  for (let d = 1; d <= decks; d++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ id: `${rankChar(rank)}${suit}.${d}`, kind: 'standard', rank, suit });
      }
    }
    for (let j = 0; j < jokersPerDeck; j++) {
      cards.push({ id: `X.${jokerNo++}`, kind: 'joker' });
    }
  }
  return cards;
}
