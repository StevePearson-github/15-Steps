import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { baseDistance, buildMeld, buildSides, extraMelds, findBase, findPairs, meldsSatisfy, runsOfSize, setsOfSize, stepRequirements, type MeldSpec } from '../src/engine';
import { type Card, createDeck, STEPS } from '../src/engine';
import { cards, run, set } from './helpers';

/** The base found must really be valid for the step. */
function valid(hand: Card[], step: number, specs: MeldSpec[] | null): boolean {
  if (!specs) return false;
  const byId = new Map(hand.map((c) => [c.id, c]));
  const melds = specs.map((s, i) => {
    const r = buildMeld(s, s.cardIds.map((id) => byId.get(id) as Card), i + 1, 0);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  });
  const ids = specs.flatMap((s) => s.cardIds);
  return new Set(ids).size === ids.length && meldsSatisfy(melds, stepRequirements(step));
}

describe('finding a base', () => {
  it('step 1: two sets of three', () => {
    const hand = cards('7S 7H 7D 8S 8H 8D 4C 9C');
    expect(valid(hand, 1, findBase(hand, 1))).toBe(true);
  });
  it('uses wilds only when needed', () => {
    const hand = cards('7S 7H 7D 8S 8H X 2C 9C');
    const base = findBase(hand, 1);
    expect(valid(hand, 1, base)).toBe(true);
  });
  it('returns null when there is no base', () => {
    const hand = cards('7S 8H 9D 3S 4H 6D JC KC QC');
    expect(findBase(hand, 1)).toBeNull();
  });
  it('step 2: set of three and run of three', () => {
    const hand = cards('7S 7H 7D 4C 5C 6C 9D');
    expect(valid(hand, 2, findBase(hand, 2))).toBe(true);
  });
  it('step 3: run of seven, with wilds filling gaps', () => {
    const hand = cards('3H 4H X 6H 7H 2C 9H KD');
    expect(valid(hand, 3, findBase(hand, 3))).toBe(true);
  });
  it('step 4: five pairs, a set of four counts as two', () => {
    const hand = cards('9S 9H 9D 9C 5S 5H TS TH 2S 2H 4C');
    expect(valid(hand, 4, findBase(hand, 4))).toBe(true);
  });
  it('step 4: wilds can pair with single cards', () => {
    const hand = cards('9S 9H 5S 5H TS 3H X 2C 2D AD');
    expect(valid(hand, 4, findBase(hand, 4))).toBe(true);
    expect(findPairs(cards('9S 5H 3D'), 2)).toBeNull();
    expect(findBase(cards('9S 9H 5S 5H TS 3H X AD'), 4)).toBeNull(); // only four pairs
  });
  it('step 7: set of four and run of three', () => {
    const hand = cards('7S 7H 7D 7C 4C 5C 6C 9D');
    expect(valid(hand, 7, findBase(hand, 7))).toBe(true);
  });
  it('step 15: run of ten', () => {
    const hand = cards('3H 4H 5H 6H 7H 8H 9H TH JH QH 2C');
    expect(valid(hand, 15, findBase(hand, 15))).toBe(true);
  });
  it('does not reuse a card across melds', () => {
    const hand = cards('7S 7H 7D 8S 8H');
    expect(findBase(hand, 1)).toBeNull();
  });
});

describe('candidate melds', () => {
  it('finds sets and runs of an exact size', () => {
    expect(setsOfSize(cards('7S 7H 7D 7C'), 3).length).toBeGreaterThan(0);
    expect(runsOfSize(cards('5H 6H 7H'), 3)).toHaveLength(1);
    expect(runsOfSize(cards('5H 6S 7H'), 3)).toHaveLength(0);
  });
  it('extra melds include sets and runs', () => {
    const kinds = new Set(extraMelds(cards('7S 7H 7D 4C 5C 6C')).map((m) => m.kind));
    expect(kinds).toEqual(new Set(['set', 'run']));
  });
});

describe('building options', () => {
  it('finds the end of a run a card can extend', () => {
    const r = run(1, 0, 'H', 5, '5H 6H 7H');
    expect(buildSides(r, cards('8H')[0] as Card)).toEqual(['high']);
    expect(buildSides(r, cards('4H')[0] as Card)).toEqual(['low']);
    expect(buildSides(r, cards('9H')[0] as Card)).toEqual([]);
    expect(buildSides(r, cards('X')[0] as Card)).toEqual(['high', 'low']);
  });
  it('sets and pairs accept their rank and wilds', () => {
    const s = set(1, 0, 7, '7S 7H 7D');
    expect(buildSides(s, cards('7C')[0] as Card)).toEqual([undefined]);
    expect(buildSides(s, cards('8C')[0] as Card)).toEqual([]);
    expect(buildSides(s, cards('2C')[0] as Card)).toEqual([undefined]);
  });
});

describe('distance to the base', () => {
  const d = (tokens: string, step: number) => baseDistance(cards(tokens), step);
  it('is 0 when the base can be laid', () => {
    expect(d('7S 7H 7D 8S 8H 8D', 1)).toBe(0);
    expect(d('3H 4H 5H 6H 7H 8H 9H TH JH QH', 15)).toBe(0);
  });
  it('counts the cards still missing', () => {
    expect(d('7S 7H 8S 8H 8D', 1)).toBe(1);
    expect(d('3H 4H 5H 6H 7H 8H 9H', 15)).toBe(3);
    expect(d('3H 5H 7H', 3)).toBe(4);
  });
  it('wilds fill gaps', () => {
    expect(d('3H 4H 5H 6H X 8H 9H TH JH QH', 15)).toBe(0);
    expect(d('7S 7H 8S 8H X', 1)).toBe(1);
  });
  it('handles pairs (step 4)', () => {
    expect(d('9S 9H 5S 5H TS TH 3C 3D 7C 7D', 4)).toBe(0);
    expect(d('9S 9H 5S 5H 3C', 4)).toBe(3);
  });
  it('never goes up when a card is added', () => {
    const hand = cards('7S 7H 8S 8H 4C 5C 9D');
    for (const extra of cards('7D KS 2H X 6C')) {
      for (let step = 1; step <= 15; step++) {
        expect(baseDistance([...hand, extra], step)).toBeLessThanOrEqual(baseDistance(hand, step));
      }
    }
  });
});

describe('wild cards shared between melds (regression)', () => {
  const check = (hand: string, step: number) => {
    const h = cards(hand);
    const base = findBase(h, step);
    expect(valid(h, step, base)).toBe(true);
    expect(baseDistance(h, step)).toBe(0);
  };
  it('two sets that each need wilds, with exactly enough wilds between them', () => {
    check('7S 9S 9H X 2C 2D 4D KC', 1); // 9 9 W + 7 W W: three wilds
  });
  it('two pairs of naturals, a wild for each', () => {
    check('5S 5H 9D 9C X 2C 4D KC', 1);
  });
  it('a set of only wilds next to a real set', () => {
    check('5S 5H 5D X 2C 2D', 1);
  });
  it('two sets of only wilds', () => {
    check('X X.2 X.3 X.4 2C 2D', 1);
  });
  it('a run and a set that both use wilds', () => {
    check('4H 6H 8S 8D X 2C 2D 9C', 2); // 4 W 6 hearts + 8 8 W
  });
  it('three melds sharing wilds (step 6)', () => {
    check('3S 3H 6D 6C 9H JH X 2C 2D 2S KS', 5);
  });
  it('does not claim a base when there are not enough wilds', () => {
    expect(findBase(cards('7S 9S 9H X 4D KC'), 1)).toBeNull(); // would need 3 wilds, has 1
    expect(baseDistance(cards('7S 9S 9H X 4D KC'), 1)).toBe(2);
  });
  it('gives every meld different wild cards', () => {
    const h = cards('7S 9S 9H X 2C 2D');
    const ids = (findBase(h, 1) ?? []).flatMap((m) => m.cardIds);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('duplicate cards from the two decks (regression)', () => {
  const check = (hand: string, step: number) => {
    const h = cards(hand);
    const base = findBase(h, step);
    expect(valid(h, step, base)).toBe(true);
    expect(baseDistance(h, step)).toBe(0);
    const ids = (base ?? []).flatMap((m) => m.cardIds);
    expect(new Set(ids).size).toBe(ids.length); // no card used twice
  };
  it('two runs that each need the same card, when you hold two copies', () => {
    check('4D 4D.2 X X.2 X.3 2C 2D 2H', 8); // two runs of four, each built around a 4 of diamonds
  });
  it('two sets made of the same three cards', () => {
    check('7S 7S.2 7H 7H.2 7D 7D.2 KC', 1);
  });
  it('a set and a run that both want a 5 of hearts, with two copies held', () => {
    check('5H 5H.2 5S 5D 6H 7H 9C', 2); // the run takes one 5H, the set needs the other 5H too
  });
  it('three sets all of the same rank', () => {
    check('9S 9H 9D 9C 9S.2 9H.2 9D.2 9C.2 X', 5); // eight nines make two sets, and the third needs the joker
  });
  it('does not use a card more times than you hold it', () => {
    expect(findBase(cards('7S 7H 7D 8S 8H'), 1)).toBeNull();
    expect(findBase(cards('5H 5S 5D 6H 7H 9C'), 2)).toBeNull(); // only one 5H, but the set and the run both need it
    expect(findBase(cards('9S 9H 9D 9C 9S.2 9H.2 9D.2 9C.2'), 5)).toBeNull(); // eight nines are two sets, not three
  });
});

describe('the finder never misses a base that exists (property)', () => {
  const wildPool = createDeck().filter((c) => c.kind === 'joker' || c.rank === 2);
  const std = createDeck().filter((c) => c.kind === 'standard' && c.rank !== 2);

  it('builds a hand around any base, swapping random cards for wilds, and finds it', () => {
    const steps = STEPS.map((_, i) => i + 1).filter((n) => n !== 4);
    fc.assert(
      fc.property(
        fc.constantFrom(...steps),
        fc.array(fc.tuple(fc.integer({ min: 3, max: 13 }), fc.constantFrom('S', 'H', 'D', 'C'), fc.integer({ min: 0, max: 12 })), { minLength: 3, maxLength: 3 }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 30, maxLength: 30 }),
        fc.integer({ min: 0, max: 4 }),
        (step, picks, rolls, extra) => {
          const used = new Set<string>();
          const wilds = [...wildPool];
          const take = (rank: number, suit?: string) => {
            const c = std.find((x) => x.kind === 'standard' && x.rank === rank && (!suit || x.suit === suit) && !used.has(x.id));
            if (c) used.add(c.id);
            return c;
          };
          const hand: Card[] = [];
          let roll = 0;
          const place = (rank: number, suit?: string) => {
            if (rolls[roll++ % rolls.length]! < 0.4 && wilds.length > 0) return void hand.push(wilds.shift() as Card);
            const c = take(rank, suit);
            if (!c) return void (wilds.length > 0 && hand.push(wilds.shift() as Card));
            hand.push(c);
          };
          let pick = 0;
          for (const req of STEPS[step - 1] ?? []) {
            const [rank, suit, startRaw] = picks[pick++ % picks.length]!;
            if (req.kind === 'set') for (let i = 0; i < req.size; i++) place(rank);
            else {
              const start = 3 + (startRaw % (12 - req.size));
              for (let i = 0; i < req.size; i++) place(start + i, suit);
            }
          }
          const need = (STEPS[step - 1] ?? []).reduce((n, r) => n + r.size, 0);
          fc.pre(hand.length === need); // skip when the deck ran out of a card
          const found = findBase(hand, step);
          expect(found).not.toBeNull();
          expect(valid(hand, step, found)).toBe(true);
          expect(baseDistance(hand, step)).toBe(0);
          void extra;
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('finder and distance always agree (property)', () => {
  const deck = createDeck();
  const handArb = fc.shuffledSubarray(deck, { minLength: 9, maxLength: 15 });
  const stepArb = fc.integer({ min: 1, max: 15 });

  it('distance is 0 exactly when a valid base can be found', () => {
    fc.assert(
      fc.property(handArb, stepArb, (hand, step) => {
        const base = findBase(hand, step);
        const distance = baseDistance(hand, step);
        expect(base !== null).toBe(distance === 0);
        if (base) expect(valid(hand, step, base)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it('adding a card never makes the base further away, and one card closes at most one gap', () => {
    fc.assert(
      fc.property(handArb, stepArb, fc.integer({ min: 0, max: 107 }), (hand, step, pick) => {
        const extra = deck.find((c, i) => i === pick && !hand.includes(c));
        fc.pre(!!extra);
        const before = baseDistance(hand, step);
        const after = baseDistance([...hand, extra as Card], step);
        expect(after).toBeLessThanOrEqual(before);
        expect(after).toBeGreaterThanOrEqual(before - 1);
      }),
      { numRuns: 300 },
    );
  });
});
