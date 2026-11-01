import { type Action, type Card, type PlayerView, baseDistance, cardPoints, isWild, nextRandom } from '../engine';
import { handPointsOf, planPlay } from './plan';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** A player, human or AI, decides one action at a time from what they can see. */
export interface Player {
  decide(view: PlayerView): Action;
}

/**
 * How often each level ignores its own judgement and draws or discards at
 * random. All levels lay down melds and build the same way once able to.
 */
export const MISTAKE_RATE: Record<Difficulty, number> = { easy: 1, medium: 0.15, hard: 0 };

/** How useful is a card to keep, given the rest of the hand? */
function keepValue(card: Card, hand: readonly Card[]): number {
  if (isWild(card)) return 30;
  if (card.kind !== 'standard') return 0;
  let v = 0;
  for (const o of hand) {
    if (o.id === card.id || o.kind !== 'standard' || isWild(o)) continue;
    if (o.rank === card.rank) v += 8;
    if (o.suit === card.suit && Math.abs(o.rank - card.rank) <= 2 && o.rank !== card.rank) v += 6;
  }
  return v;
}

/** The best card to throw away: high points, little use, never one the base still needs. */
function bestDiscard(view: PlayerView, hand: readonly Card[]): Card {
  const me = view.players[view.me];
  const seeking = !!me && !me.baseLaid;
  const step = me?.step ?? 1;
  const distance = seeking ? baseDistance(hand, step) : 0;
  const scored = hand.map((c) => {
    let s = cardPoints(c) - 3 * keepValue(c, hand);
    if (seeking) {
      const rest = hand.filter((o) => o.id !== c.id);
      s -= 1000 * (baseDistance(rest, step) - distance);
    }
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return (scored[0] as { c: Card }).c;
}

export function createAI(difficulty: Difficulty, seed = 1): Player {
  let rng = seed >>> 0;
  const random = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const mistake = () => random() < MISTAKE_RATE[difficulty];
  // Cards already picked up from the discard pile this round. Taking each at
  // most once stops two players endlessly swapping the same cards.
  let pickedRound = 0;
  const picked = new Set<string>();

  return {
    decide(view: PlayerView): Action {
      if (view.phase === 'roundOver') return { type: 'nextRound' };
      const me = view.players[view.me];
      if (!me) throw new Error('No such player');
      const hand = me.hand ?? [];
      const top = view.discard.at(-1);
      const plan = (h: readonly Card[]) =>
        planPlay({ hand: h, step: me.step, baseLaid: me.baseLaid, melds: view.melds, nextMeldId: view.nextMeldId, me: view.me });

      if (view.phase === 'draw') {
        if (view.round !== pickedRound) {
          pickedRound = view.round;
          picked.clear();
        }
        if (!top || picked.has(top.id)) return { type: 'drawStock' };
        const takeDiscard = (): Action => {
          picked.add(top.id);
          return { type: 'drawDiscard' };
        };
        if (mistake()) return random() < 0.25 ? takeDiscard() : { type: 'drawStock' };
        const withTop = [...hand, top];
        if (!me.baseLaid) {
          // Take the discard only if it brings the base closer.
          return baseDistance(withTop, me.step) < baseDistance(hand, me.step)
            ? takeDiscard()
            : { type: 'drawStock' };
        }
        // Base is down: take it if it lets us shed more than a blind draw would.
        const now = plan(hand);
        const after = plan(withTop);
        const left = (cards: readonly Card[], extra: boolean) =>
          handPointsOf(cards) - (extra ? Math.max(...cards.map(cardPoints), 0) : 0);
        return left(after.remaining, true) < left(now.remaining, false) - 1 || keepValue(top, withTop) >= 14
          ? takeDiscard()
          : { type: 'drawStock' };
      }

      // Play phase: lay down and build whatever the plan says, then discard.
      const next = plan(hand).actions[0];
      if (next) return next;
      const card = mistake() ? (hand[Math.floor(random() * hand.length)] as Card) : bestDiscard(view, hand);
      return { type: 'discard', cardId: card.id };
    },
  };
}
