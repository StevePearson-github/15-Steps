import { describe, expect, it } from 'vitest';
import { cardPoints, createDeck, handPoints, shuffle } from '../src/engine';
import { card, cards } from './helpers';

describe('deck', () => {
  it('has 108 unique cards: 2 x (52 + 2 jokers)', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    expect(deck.filter((c) => c.kind === 'joker')).toHaveLength(4);
  });
  it('has two of every standard card', () => {
    const deck = createDeck();
    expect(deck.filter((c) => c.id.startsWith('5S.'))).toHaveLength(2);
  });
});

describe('card points', () => {
  it.each([
    ['X', 50],
    ['2S', 20],
    ['AH', 15],
    ['TD', 10],
    ['JC', 10],
    ['QS', 10],
    ['KH', 10],
    ['3S', 5],
    ['9D', 5],
  ])('%s is worth %i', (token, points) => {
    expect(cardPoints(card(token))).toBe(points);
  });
  it('sums a hand', () => {
    expect(handPoints(cards('X 2S AH KD 5C'))).toBe(50 + 20 + 15 + 10 + 5);
  });
});

describe('shuffle', () => {
  it('is deterministic for a seed and keeps every card', () => {
    const a = shuffle(createDeck(), 42);
    const b = shuffle(createDeck(), 42);
    expect(a.items.map((c) => c.id)).toEqual(b.items.map((c) => c.id));
    expect(a.items.map((c) => c.id).sort()).toEqual(createDeck().map((c) => c.id).sort());
  });
  it('differs between seeds', () => {
    const a = shuffle(createDeck(), 1).items.map((c) => c.id);
    const b = shuffle(createDeck(), 2).items.map((c) => c.id);
    expect(a).not.toEqual(b);
  });
});
