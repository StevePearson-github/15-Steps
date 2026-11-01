import {
  type Action, type Card, type Meld, type MeldSpec, buildMeld, buildSides, cardPoints,
  extendMeld, extraMelds, findBase,
} from '../engine';

export interface TurnPlan {
  /** Actions to play this turn, in order (does not include the final discard). */
  actions: Action[];
  /** Cards left in hand once the plan is carried out (at least one). */
  remaining: Card[];
  /** Whether the base would be laid by this plan or already was. */
  baseLaid: boolean;
}

export interface PlanInput {
  hand: readonly Card[];
  step: number;
  baseLaid: boolean;
  melds: readonly Meld[];
  nextMeldId: number;
  me: number;
  /** When true, a completed base is kept in hand instead of being laid down. */
  holdBase?: boolean;
}

const points = (cards: readonly Card[]) => cards.reduce((n, c) => n + cardPoints(c), 0);

function specCards(spec: MeldSpec, hand: readonly Card[]): Card[] {
  const byId = new Map(hand.map((c) => [c.id, c]));
  return spec.cardIds.map((id) => byId.get(id) as Card);
}

/**
 * Work out what to lay down, extend and build this turn. Greedy: lay the base
 * if possible, then add the extra melds that shed the most points, then build
 * leftover cards onto the table. Always keeps one card for the final discard.
 */
export function planPlay(input: PlanInput): TurnPlan {
  let hand = [...input.hand];
  let melds = [...input.melds];
  let nextId = input.nextMeldId;
  let baseLaid = input.baseLaid;
  const actions: Action[] = [];

  const remove = (ids: string[]) => {
    const drop = new Set(ids);
    hand = hand.filter((c) => !drop.has(c.id));
  };

  if (!baseLaid) {
    const base = input.holdBase ? null : findBase(hand, input.step);
    const used = base?.flatMap((m) => m.cardIds).length ?? 0;
    if (!base || used >= hand.length) return { actions, remaining: hand, baseLaid };
    for (const spec of base) {
      const built = buildMeld(spec, specCards(spec, hand), nextId++, input.me);
      if (built.ok) melds.push(built.value);
    }
    actions.push({ type: 'layBase', melds: base });
    remove(base.flatMap((m) => m.cardIds));
    baseLaid = true;
  }
  if (!baseLaid) return { actions, remaining: hand, baseLaid };

  // Extra sets and runs, biggest point-shed first.
  for (;;) {
    let best: MeldSpec | null = null;
    let bestScore = 0;
    for (const spec of extraMelds(hand)) {
      if (spec.cardIds.length >= hand.length) continue;
      const cs = specCards(spec, hand);
      const score = points(cs) * 100 + cs.length - cs.filter((c) => cardPoints(c) >= 20).length;
      if (score > bestScore) {
        best = spec;
        bestScore = score;
      }
    }
    if (!best) break;
    const built = buildMeld(best, specCards(best, hand), nextId++, input.me);
    if (!built.ok) break;
    melds.push(built.value);
    actions.push({ type: 'layMeld', meld: best });
    remove(best.cardIds);
  }

  // Build single cards onto any meld on the table.
  for (let progress = true; progress && hand.length > 1; ) {
    progress = false;
    for (const card of [...hand].sort((a, b) => cardPoints(b) - cardPoints(a))) {
      const target = melds.find((m) => buildSides(m, card).length > 0);
      if (!target) continue;
      const side = buildSides(target, card)[0];
      const extended = extendMeld(target, [card], side);
      if (!extended.ok) continue;
      melds = melds.map((m) => (m.id === target.id ? extended.value : m));
      actions.push({ type: 'build', meldId: target.id, cardIds: [card.id], ...(side ? { side } : {}) });
      remove([card.id]);
      progress = true;
      break;
    }
  }
  return { actions, remaining: hand, baseLaid };
}

export const handPointsOf = points;
