import { type Card, createDeck, handPoints } from './cards';
import { type Meld, type MeldSpec, buildMeld, extendMeld, meldsSatisfy } from './melds';
import { shuffle } from './rng';
import { FINAL_STEP, stepRequirements } from './steps';

export interface RulesOptions {
  handSize: number;
  decks: number;
  jokersPerDeck: number;
}

export const DEFAULT_OPTIONS: RulesOptions = { handSize: 13, decks: 2, jokersPerDeck: 2 };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface GameConfig {
  playerNames: string[];
  seed: number;
  /** Index of the first dealer. Defaults to 0. */
  dealer?: number;
  options?: Partial<RulesOptions>;
}

export interface PlayerState {
  name: string;
  hand: Card[];
  /** Current step, 1..15. */
  step: number;
  /** Whether this player has laid down their base this round. */
  baseLaid: boolean;
  /** Cumulative penalty score (lower is better). */
  score: number;
}

export type Phase = 'draw' | 'play' | 'roundOver' | 'gameOver';

export interface RoundResult {
  wentOut: number;
  penalties: number[];
}

export type Action =
  | { type: 'drawStock' }
  | { type: 'drawDiscard' }
  | { type: 'layBase'; melds: MeldSpec[] }
  | { type: 'layMeld'; meld: MeldSpec }
  | { type: 'build'; meldId: number; cardIds: string[]; side?: 'low' | 'high' }
  | { type: 'discard'; cardId: string }
  | { type: 'nextRound' };

export type GameEvent =
  | { type: 'roundStarted'; round: number; dealer: number }
  | { type: 'cardDrawn'; player: number; from: 'stock' | 'discard' }
  | { type: 'stockReshuffled' }
  | { type: 'baseLaid'; player: number; meldIds: number[] }
  | { type: 'meldLaid'; player: number; meldId: number }
  | { type: 'meldExtended'; player: number; meldId: number }
  | { type: 'cardDiscarded'; player: number; card: Card }
  | { type: 'wentOut'; player: number }
  | { type: 'roundEnded'; result: RoundResult }
  | { type: 'gameEnded'; winner: number };

export interface GameState {
  options: RulesOptions;
  seed: number;
  rngState: number;
  round: number;
  dealer: number;
  current: number;
  phase: Phase;
  players: PlayerState[];
  /** Top of the stock is the last element. */
  stock: Card[];
  /** Top of the discard pile is the last element. */
  discard: Card[];
  melds: Meld[];
  nextMeldId: number;
  lastRound: RoundResult | null;
  winner: number | null;
  actionLog: Action[];
}

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

const fail = (error: string): ActionResult => ({ ok: false, error });

export function createGame(config: GameConfig): GameState {
  const n = config.playerNames.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new Error(`Players must be between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
  }
  const options = { ...DEFAULT_OPTIONS, ...config.options };
  const dealer = config.dealer ?? 0;
  if (!Number.isInteger(dealer) || dealer < 0 || dealer >= n) throw new Error('Invalid dealer');
  const state: GameState = {
    options,
    seed: config.seed,
    rngState: config.seed >>> 0,
    round: 0,
    dealer,
    current: 0,
    phase: 'draw',
    players: config.playerNames.map((name) => ({ name, hand: [], step: 1, baseLaid: false, score: 0 })),
    stock: [],
    discard: [],
    melds: [],
    nextMeldId: 1,
    lastRound: null,
    winner: null,
    actionLog: [],
  };
  deal(state, [], dealer);
  return state;
}

/** Shuffle a fresh deck, deal hands and turn up the first discard. Mutates `s`. */
function deal(s: GameState, events: GameEvent[], dealer: number): void {
  const { items, rngState } = shuffle(
    createDeck(s.options.decks, s.options.jokersPerDeck),
    s.rngState,
  );
  s.rngState = rngState;
  s.round += 1;
  s.dealer = dealer;
  s.melds = [];
  s.lastRound = null;
  const n = s.players.length;
  const needed = n * s.options.handSize + 1;
  if (items.length < needed) throw new Error('Not enough cards to deal');
  for (const p of s.players) {
    p.hand = [];
    p.baseLaid = false;
  }
  for (let i = 0; i < s.options.handSize; i++) {
    for (const p of s.players) p.hand.push(items.pop() as Card);
  }
  s.stock = items;
  s.discard = [s.stock.pop() as Card];
  s.current = (dealer + 1) % n;
  s.phase = 'draw';
  events.push({ type: 'roundStarted', round: s.round, dealer });
}

/** Remove the cards with these ids from a hand copy. Fails on missing or repeated ids. */
function pick(hand: Card[], ids: string[]): Card[] | null {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const id of ids) {
    if (seen.has(id)) return null;
    seen.add(id);
    const card = hand.find((c) => c.id === id);
    if (!card) return null;
    out.push(card);
  }
  return out;
}

function removeFromHand(hand: Card[], ids: string[]): Card[] {
  const drop = new Set(ids);
  return hand.filter((c) => !drop.has(c.id));
}

export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.phase === 'gameOver') return fail('The game is over');
  // Deep-copy everything except the (append-only) action log, which is copied by reference.
  const { actionLog, ...rest } = state;
  const s: GameState = { ...structuredClone(rest), actionLog };
  const events: GameEvent[] = [];
  const error = perform(s, action, events);
  if (error) return fail(error);
  s.actionLog = [...actionLog, action];
  return { ok: true, state: s, events };
}

function perform(s: GameState, action: Action, events: GameEvent[]): string | null {
  if (action.type === 'nextRound') {
    if (s.phase !== 'roundOver') return 'The round is not over';
    for (const p of s.players) p.baseLaid = false; // steps were already advanced
    deal(s, events, (s.dealer + 1) % s.players.length);
    return null;
  }
  if (s.phase === 'roundOver') return 'The round is over';
  const me = s.current;
  const player = s.players[me] as PlayerState;

  switch (action.type) {
    case 'drawStock':
    case 'drawDiscard': {
      if (s.phase !== 'draw') return 'You have already drawn this turn';
      if (action.type === 'drawStock') {
        if (s.stock.length === 0 && s.discard.length > 1) {
          const top = s.discard.pop() as Card;
          const r = shuffle(s.discard, s.rngState);
          s.rngState = r.rngState;
          s.stock = r.items;
          s.discard = [top];
          events.push({ type: 'stockReshuffled' });
        }
        const card = s.stock.pop();
        if (!card) return 'The stock is empty';
        player.hand.push(card);
        events.push({ type: 'cardDrawn', player: me, from: 'stock' });
      } else {
        const card = s.discard.pop();
        if (!card) return 'The discard pile is empty';
        player.hand.push(card);
        events.push({ type: 'cardDrawn', player: me, from: 'discard' });
      }
      s.phase = 'play';
      return null;
    }

    case 'layBase': {
      if (s.phase !== 'play') return 'Draw a card first';
      if (player.baseLaid) return 'You have already laid down your base';
      const ids = action.melds.flatMap((m) => m.cardIds);
      const cards = pick(player.hand, ids);
      if (!cards) return 'You do not hold those cards';
      if (player.hand.length - ids.length < 1) return 'You must keep a card to discard';
      const melds: Meld[] = [];
      let offset = 0;
      for (const spec of action.melds) {
        const slice = cards.slice(offset, offset + spec.cardIds.length);
        offset += spec.cardIds.length;
        const built = buildMeld(spec, slice, s.nextMeldId + melds.length, me);
        if (!built.ok) return built.error;
        melds.push(built.value);
      }
      if (!meldsSatisfy(melds, stepRequirements(player.step))) {
        return `Those melds do not make up Step ${player.step}`;
      }
      player.hand = removeFromHand(player.hand, ids);
      player.baseLaid = true;
      s.melds.push(...melds);
      s.nextMeldId += melds.length;
      events.push({ type: 'baseLaid', player: me, meldIds: melds.map((m) => m.id) });
      return null;
    }

    case 'layMeld': {
      if (s.phase !== 'play') return 'Draw a card first';
      if (!player.baseLaid) return 'Lay down your base first';
      const spec = action.meld;
      if (spec.kind === 'pair') return 'Extra melds must be sets or runs';
      const cards = pick(player.hand, spec.cardIds);
      if (!cards) return 'You do not hold those cards';
      if (player.hand.length - cards.length < 1) return 'You must keep a card to discard';
      const built = buildMeld(spec, cards, s.nextMeldId, me);
      if (!built.ok) return built.error;
      player.hand = removeFromHand(player.hand, spec.cardIds);
      s.melds.push(built.value);
      s.nextMeldId += 1;
      events.push({ type: 'meldLaid', player: me, meldId: built.value.id });
      return null;
    }

    case 'build': {
      if (s.phase !== 'play') return 'Draw a card first';
      if (!player.baseLaid) return 'Lay down your base first';
      const index = s.melds.findIndex((m) => m.id === action.meldId);
      if (index === -1) return 'No such meld';
      const cards = pick(player.hand, action.cardIds);
      if (!cards) return 'You do not hold those cards';
      if (player.hand.length - cards.length < 1) return 'You must keep a card to discard';
      const extended = extendMeld(s.melds[index] as Meld, cards, action.side);
      if (!extended.ok) return extended.error;
      player.hand = removeFromHand(player.hand, action.cardIds);
      s.melds[index] = extended.value;
      events.push({ type: 'meldExtended', player: me, meldId: action.meldId });
      return null;
    }

    case 'discard': {
      if (s.phase !== 'play') return 'Draw a card first';
      const card = player.hand.find((c) => c.id === action.cardId);
      if (!card) return 'You do not hold that card';
      player.hand = removeFromHand(player.hand, [action.cardId]);
      s.discard.push(card);
      events.push({ type: 'cardDiscarded', player: me, card });
      if (player.hand.length === 0) {
        endRound(s, me, events);
      } else {
        s.current = (me + 1) % s.players.length;
        s.phase = 'draw';
      }
      return null;
    }
  }
}

function endRound(s: GameState, wentOut: number, events: GameEvent[]): void {
  events.push({ type: 'wentOut', player: wentOut });
  const penalties = s.players.map((p, i) => (i === wentOut ? 0 : handPoints(p.hand)));
  const goerStep = (s.players[wentOut] as PlayerState).step;
  // Taken before anyone advances: only players who laid Step 15's base this round have finished all 15 steps.
  const finishers = s.players.map((p, i) => (p.step === FINAL_STEP && p.baseLaid ? i : -1)).filter((i) => i >= 0);
  s.players.forEach((p, i) => {
    p.score += penalties[i] as number;
    if (p.baseLaid && p.step < FINAL_STEP) p.step += 1;
  });
  const result: RoundResult = { wentOut, penalties };
  s.lastRound = result;
  events.push({ type: 'roundEnded', result });

  // The lowest score among the finishers wins; a tie for lowest means play continues.
  const best = Math.min(...finishers.map((i) => (s.players[i] as PlayerState).score));
  const leaders = finishers.filter((i) => (s.players[i] as PlayerState).score === best);
  if (goerStep === FINAL_STEP && leaders.length === 1) {
    const winner = leaders[0] as number;
    s.phase = 'gameOver';
    s.winner = winner;
    events.push({ type: 'gameEnded', winner });
  } else {
    s.phase = 'roundOver';
  }
}

/** The simple (non-meld) actions available to the current player. */
export function simpleLegalActions(state: GameState): Action[] {
  if (state.phase === 'roundOver') return [{ type: 'nextRound' }];
  if (state.phase === 'gameOver') return [];
  if (state.phase === 'draw') {
    const out: Action[] = [];
    if (state.stock.length > 0 || state.discard.length > 1) out.push({ type: 'drawStock' });
    if (state.discard.length > 0) out.push({ type: 'drawDiscard' });
    return out;
  }
  const hand = (state.players[state.current] as PlayerState).hand;
  const seen = new Set<string>();
  return hand.filter((c) => !seen.has(c.id) && seen.add(c.id)).map((c) => ({ type: 'discard', cardId: c.id }));
}
