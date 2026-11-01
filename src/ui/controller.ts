import { createAI, type Difficulty, type Player } from '../ai/player';
import {
  type Action, type Card, type GameEvent, type GameState, type Meld, type MeldSpec,
  applyAction, buildMeld, closestBase, createGame, extendMeld, extraMelds, findBase, isWild, meldsSatisfy, resolveMeld,
  stepRequirements, viewFor, wildCount,
} from '../engine';

/**
 * UI-independent game controller: seats, the game log, AI stepping, saving, and
 * helpers that turn a player's card selection into engine actions. The React
 * components only display this and forward clicks, so all of it is testable.
 */

export type SeatKind = 'human' | Difficulty;
export interface Seat {
  name: string;
  kind: SeatKind;
}
export interface Session {
  state: GameState;
  seats: Seat[];
  log: string[];
  /**
   * States to go back to, most recent last: the human's plays this turn (laying
   * down and building). Drawing and discarding clear it. A draw cannot be undone
   * because undo-and-redraw would let a player peek at the stock for free.
   */
  undoStack: GameState[];
  /** What the last action did, so sound can react. Transient: never saved. */
  events?: GameEvent[];
}
export interface SetupOptions {
  name: string;
  opponents: Difficulty[];
  seed: number;
  /** No human seat: every seat is an AI (opponents). */
  spectate?: boolean;
}

/** A colour for each seat, used for the dot beside a player's name wherever it appears. */
export const SEAT_COLORS = ['#e04b3e', '#3e8be0', '#38b27a', '#f08a3c', '#9b5de5', '#17a2b8'];
export const seatColor = (seat: number): string => SEAT_COLORS[seat % SEAT_COLORS.length] as string;
/** A little face for each kind of player. */
export const AVATARS: Record<SeatKind, string> = { human: '🙂', easy: '🐣', medium: '🤖', hard: '🧠' };

const AI_NAMES = ['Ada', 'Ben', 'Cleo', 'Dax', 'Eve', 'Finn'];
export const MAX_LOG = 8;

export function createSession(opts: SetupOptions): Session {
  const seats: Seat[] = [];
  if (!opts.spectate) seats.push({ name: opts.name.trim() || 'You', kind: 'human' });
  opts.opponents.forEach((kind, i) => seats.push({ name: `${AI_NAMES[i % AI_NAMES.length]}`, kind }));
  const state = createGame({
    playerNames: seats.map((s) => s.name),
    seed: opts.seed,
    dealer: opts.seed % seats.length,
  });
  const dealer = seats[state.dealer]?.name ?? '';
  return { state, seats, log: [`Round 1. ${dealer} ${verb(dealer, 'deal', 'deals')}.`], undoStack: [] };
}

export function humanSeat(session: Session): number {
  return session.seats.findIndex((s) => s.kind === 'human');
}

/** One AI instance per computer seat. Recreated after loading a save. */
export function makePlayers(seats: Seat[], seed: number): (Player | null)[] {
  return seats.map((s, i) => (s.kind === 'human' ? null : createAI(s.kind, seed * 31 + i + 1)));
}

export type ApplyResult = { ok: true; session: Session } | { ok: false; error: string };

const UNDOABLE = new Set<Action['type']>(['layBase', 'layMeld', 'build']);
export const MAX_UNDO = 30;

export function apply(session: Session, action: Action): ApplyResult {
  const r = applyAction(session.state, action);
  if (!r.ok) return { ok: false, error: r.error };
  const lines = r.events.map((e) => describeEvent(e, r.state, session.seats)).filter((l): l is string => !!l);
  const human = session.seats[session.state.current]?.kind === 'human';
  const stack = session.undoStack ?? [];
  const undoStack = human && UNDOABLE.has(action.type) ? [...stack, session.state].slice(-MAX_UNDO) : [];
  return { ok: true, session: { ...session, state: r.state, log: [...session.log, ...lines].slice(-MAX_LOG), undoStack, events: r.events } };
}

export const canUndo = (session: Session): boolean =>
  (session.undoStack?.length ?? 0) > 0 && session.state.phase === 'play' && session.seats[session.state.current]?.kind === 'human';

/** Take back the human's most recent play this turn. */
export function undo(session: Session): Session {
  if (!canUndo(session)) return session;
  const stack = session.undoStack;
  const previous = stack[stack.length - 1] as GameState;
  return { ...session, events: [], state: previous, undoStack: stack.slice(0, -1), log: [...session.log, 'You took back your last play.'].slice(-MAX_LOG) };
}

/** If it is a computer seat's turn, play one action for it. */
export function aiStep(session: Session, players: (Player | null)[]): Session | null {
  const s = session.state;
  if (s.phase === 'gameOver' || s.phase === 'roundOver') return null;
  const player = players[s.current];
  if (!player) return null;
  const action = player.decide(viewFor(s, s.current));
  const r = apply(session, action);
  if (!r.ok) throw new Error(`AI made an illegal move: ${r.error}`);
  return r.session;
}

export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const rankLabel = (rank: number): string => RANK_LABEL[rank === 14 ? 1 : rank] ?? '?';
export const cardLabel = (c: Card): string => (c.kind === 'joker' ? 'Joker' : `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`);

/** "You win" but "Ada wins": the human seat is called "You" by default. */
const isYou = (name: string) => name === 'You';
export const verb = (name: string, plural: string, singular: string) => (isYou(name) ? plural : singular);
const their = (name: string) => (isYou(name) ? 'your' : 'their');

function describeEvent(e: GameEvent, state: GameState, seats: Seat[]): string | null {
  const name = (i: number) => seats[i]?.name ?? `Player ${i + 1}`;
  switch (e.type) {
    case 'roundStarted':
      return `Round ${e.round}. ${name(e.dealer)} ${verb(name(e.dealer), 'deal', 'deals')}.`;
    case 'cardDrawn':
    {
      // The drawn card is the last one in hand. The discard is public, but a card from the stock is
      // only named for the human: what a computer drew from the stock is its own secret.
      const drawn = state.players[e.player]?.hand.at(-1);
      const known = drawn && (e.from === 'discard' || seats[e.player]?.kind === 'human');
      const what = known ? cardLabel(drawn) : e.from === 'stock' ? 'a card' : 'the discard';
      return `${name(e.player)} drew ${what} from the ${e.from === 'stock' ? 'stock' : 'discard pile'}.`;
    }
    case 'stockReshuffled':
      return 'The discards were shuffled into a new stock.';
    case 'baseLaid':
      return `${name(e.player)} laid down ${their(name(e.player))} base.`;
    case 'meldLaid':
      return `${name(e.player)} laid down a meld.`;
    case 'meldExtended':
      return `${name(e.player)} added to a meld.`;
    case 'cardDiscarded':
      return `${name(e.player)} discarded ${cardLabel(e.card)}.`;
    case 'wentOut':
      return `${name(e.player)} went out!`;
    case 'roundEnded':
      return `Round over. Penalties: ${e.result.penalties.map((p, i) => `${name(i)} ${p}`).join(', ')}.`;
    case 'gameEnded':
      return `${name(e.winner)} ${verb(name(e.winner), 'win', 'wins')} the game with ${state.players[e.winner]?.score} points!`;
  }
}

// ---- Describing steps and melds ----

export function describeStep(step: number): string {
  const word = (n: number) => ['', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);
  const groups: { kind: string; size: number; n: number }[] = [];
  for (const r of stepRequirements(step)) {
    const g = groups.find((x) => x.kind === r.kind && x.size === r.size);
    if (g) g.n++;
    else groups.push({ kind: r.kind, size: r.size, n: 1 });
  }
  return groups
    .map((g) => (g.kind === 'pair' ? `${word(g.n)} pairs` : `${word(g.n)} ${g.kind}${g.n > 1 ? 's' : ''} of ${g.size}`))
    .join(' + ');
}

export function describeSpec(spec: MeldSpec): string {
  if (spec.kind === 'run') {
    const end = spec.start + spec.cardIds.length - 1;
    return `Run of ${spec.cardIds.length}: ${rankLabel(spec.start)}–${rankLabel(end)} ${SUIT_SYMBOL[spec.suit]}`;
  }
  return `${spec.kind === 'pair' ? 'Pair' : `Set of ${spec.cardIds.length}`}: ${rankLabel(spec.rank)}s`;
}

// ---- Turning a card selection into melds ----

/**
 * Every sensible way the selected cards could be laid as one meld. `kinds`
 * narrows it, e.g. to what the current step needs.
 */
export function meldOptions(cards: Card[], allowPair: boolean, kinds?: readonly MeldSpec['kind'][]): MeldSpec[] {
  const options =
    cards.length === 2
      ? allowPair ? resolveMeld('pair', cards) : []
      : cards.length < 3 ? [] : [...resolveMeld('set', cards), ...resolveMeld('run', cards)];
  return kinds ? options.filter((o) => kinds.includes(o.kind)) : options;
}

/** The kinds of meld a step's base is made of. */
export function stepKinds(step: number): MeldSpec['kind'][] {
  return [...new Set(stepRequirements(step).map((r) => r.kind))];
}

/**
 * Can the selected cards, between them, make up the step's base? If so, how.
 * Lets a player select the base cards and lay them down without staging each meld.
 */
export function baseFromSelection(selected: readonly Card[], step: number): MeldSpec[] | null {
  const base = findBase(selected, step);
  if (!base) return null;
  const used = base.reduce((n, m) => n + m.cardIds.length, 0);
  return used === selected.length ? base : null;
}

/**
 * For a selection that makes up the base: each of its melds with every reading it
 * could have (a wild at the end of a run can stand for the card above or below).
 * The player is asked to pick wherever there is more than one.
 */
export function baseChoices(selected: readonly Card[], step: number): MeldSpec[][] | null {
  const base = baseFromSelection(selected, step);
  if (!base) return null;
  const byId = new Map(selected.map((c) => [c.id, c]));
  return base.map((spec) => {
    const cards = spec.cardIds.map((id) => byId.get(id) as Card);
    const options = meldOptions(cards, true, [spec.kind]);
    return options.length > 0 ? options : [spec];
  });
}

/** Do these staged melds make up the player's base? */
export function stagedMeetBase(staged: MeldSpec[], hand: readonly Card[], step: number): boolean {
  const byId = new Map(hand.map((c) => [c.id, c]));
  const melds: Meld[] = [];
  for (const [i, spec] of staged.entries()) {
    const cards = spec.cardIds.map((id) => byId.get(id));
    if (cards.some((c) => !c)) return false;
    const built = buildMeld(spec, cards as Card[], i + 1, 0);
    if (!built.ok) return false;
    melds.push(built.value);
  }
  return meldsSatisfy(melds, stepRequirements(step));
}

/**
 * Order cards for adding to a run: each card must sit next to the last. Cards
 * that fit naturally go first; wilds fill whatever is left.
 */
export function orderForBuild(meld: Meld, cards: Card[], side?: 'low' | 'high'): Card[] | null {
  if (meld.kind !== 'run') return cards;
  if (!side) return null;
  let current: Meld = meld;
  const left = [...cards];
  const ordered: Card[] = [];
  while (left.length > 0) {
    const pick = left.find((c) => !isWild(c) && extendMeld(current, [c], side).ok) ?? left.find((c) => isWild(c));
    if (!pick) return null;
    const next = extendMeld(current, [pick], side);
    if (!next.ok) return null;
    current = next.value;
    ordered.push(pick);
    left.splice(left.indexOf(pick), 1);
  }
  return ordered;
}

export type SortDir = 'asc' | 'desc';
export type SortKey = 'sets' | 'runs' | 'suit' | 'rank';

const SUIT_ORDER = 'SHDC';
const suitOf = (c: Card) => (c.kind === 'standard' ? SUIT_ORDER.indexOf(c.suit) : 9);
const isNatural = (c: Card): c is Extract<Card, { kind: 'standard' }> => c.kind === 'standard' && c.rank !== 2;
const dirFactor = (dir: SortDir) => (dir === 'asc' ? 1 : -1);
/** Aces sort high (after the king) in every sort. */
const high = (c: Extract<Card, { kind: 'standard' }>) => (c.rank === 1 ? 14 : c.rank);

/** Wild cards always go at the end of a hand: 2s in suit order, then jokers. */
const wildsLast = (hand: readonly Card[]): Card[] =>
  hand.filter((c) => !isNatural(c)).sort((a, b) => (a.kind === 'joker' ? 1 : 0) - (b.kind === 'joker' ? 1 : 0) || suitOf(a) - suitOf(b));

/**
 * Sort by suit, then rank within the suit. Ascending is spades, hearts,
 * diamonds, clubs with low cards first; descending reverses both. Wilds last.
 */
export function sortHand(hand: readonly Card[], dir: SortDir = 'asc'): Card[] {
  const f = dirFactor(dir);
  const natural = hand.filter(isNatural).sort((a, b) => f * (suitOf(a) * 20 + high(a) - (suitOf(b) * 20 + high(b))));
  return [...natural, ...wildsLast(hand)];
}

/** Sort by rank (aces high), ties by suit. Wilds last. */
export function sortHandByRank(hand: readonly Card[], dir: SortDir = 'asc'): Card[] {
  const f = dirFactor(dir);
  const natural = hand.filter(isNatural).sort((a, b) => f * (high(a) - high(b) || suitOf(a) - suitOf(b)));
  return [...natural, ...wildsLast(hand)];
}

/**
 * Group matching ranks together, biggest groups first (pairs and threes of a
 * kind lead, singles trail). Ascending puts low ranks first among groups of the
 * same size. Wilds last.
 */
export function sortHandBySets(hand: readonly Card[], dir: SortDir = 'asc'): Card[] {
  const f = dirFactor(dir);
  const groups = new Map<number, Card[]>();
  for (const c of hand.filter(isNatural)) groups.set(high(c), [...(groups.get(high(c)) ?? []), c]);
  const ordered = [...groups.entries()]
    .sort(([ra, a], [rb, b]) => b.length - a.length || f * (ra - rb))
    .flatMap(([, cs]) => cs.sort((a, b) => suitOf(a) - suitOf(b)));
  return [...ordered, ...wildsLast(hand)];
}

/**
 * Line up consecutive cards of a suit into runs, longest first (an ace may
 * follow a king). Then runs of two (one wild from a run of three), then loose
 * cards. Ascending lists each run low to high and puts lower runs first;
 * descending is high to low. Wilds last.
 */
export function sortHandByRuns(hand: readonly Card[], dir: SortDir = 'asc'): Card[] {
  type Std = Extract<Card, { kind: 'standard' }>;
  const f = dirFactor(dir);
  const pos = (c: Std) => high(c); // an ace follows a king
  const chains: Std[][] = [];
  for (const suit of SUIT_ORDER) {
    const left = hand.filter(isNatural).filter((c) => c.suit === suit);
    while (left.length > 0) {
      left.sort((a, b) => pos(a) - pos(b));
      const chain: Std[] = [left.shift() as Std];
      for (let i = 0; i < left.length; ) {
        const c = left[i] as Std;
        if (pos(c) === pos(chain[chain.length - 1] as Std) + 1) chain.push(...left.splice(i, 1));
        else i++;
      }
      chains.push(chain);
    }
  }
  const tier = (c: Std[]) => (c.length >= 3 ? 0 : c.length === 2 ? 1 : 2);
  chains.sort((a, b) => tier(a) - tier(b) || b.length - a.length || f * (pos(a[0] as Std) - pos(b[0] as Std)));
  const ordered = chains.flatMap((c) => (dir === 'asc' ? c : [...c].reverse()));
  return [...ordered, ...wildsLast(hand)];
}

/**
 * Smart sort: line the hand up for the turn. First the cards of the step's
 * base, as close to complete as the hand allows (skipped once the base is
 * down). Then as many extra sets and runs as the rest of the hand can make,
 * ones without wilds first. Whatever is left over, the discard candidates,
 * goes last in suit order, with wilds at the very end.
 */
export function sortHandSmart(hand: readonly Card[], step: number, baseLaid: boolean): Card[] {
  const groups: Card[][] = baseLaid ? [] : closestBase(hand, step);
  let rest = hand.filter((c) => !groups.some((g) => g.includes(c)));
  const take = (spec: { cardIds: string[] }) => {
    const ids = new Set(spec.cardIds);
    groups.push(rest.filter((c) => ids.has(c.id)).sort((a, b) => spec.cardIds.indexOf(a.id) - spec.cardIds.indexOf(b.id)));
    rest = rest.filter((c) => !ids.has(c.id));
  };
  for (const allowWilds of [false, true]) {
    for (;;) {
      const options = extraMelds(rest)
        .map((spec) => ({ spec, wilds: wildCount(spec, rest) }))
        .filter((o) => (allowWilds ? o.wilds > 0 && o.spec.cardIds.length - o.wilds >= 2 : o.wilds === 0));
      options.sort((a, b) => b.spec.cardIds.length - a.spec.cardIds.length || a.wilds - b.wilds);
      const best = options[0];
      if (!best) break;
      take(best.spec);
    }
  }
  return [...groups.flat(), ...sortHand(rest)];
}

export const SORTERS: Record<SortKey, (hand: readonly Card[], dir?: SortDir) => Card[]> = {
  sets: sortHandBySets,
  runs: sortHandByRuns,
  suit: sortHand,
  rank: sortHandByRank,
};

/**
 * Put a hand in the player's own order. Cards the player has already placed
 * keep their place, and cards they have not placed yet (new draws, a new
 * round) go on the end. With no custom order yet, the hand is sorted.
 */
export function arrangeHand(cards: readonly Card[], order: readonly string[]): Card[] {
  if (order.length === 0) return sortHand(cards);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const placed = order.map((id) => byId.get(id)).filter((c): c is Card => !!c);
  const placedIds = new Set(placed.map((c) => c.id));
  const fresh = cards.filter((c) => !placedIds.has(c.id));
  return [...placed, ...(placed.length === 0 ? sortHand(fresh) : fresh)];
}

/**
 * Move several cards to an insertion point (0..n, counted before they are
 * removed). The cards keep their relative order and end up side by side.
 */
export function moveCards(ids: readonly string[], group: readonly string[], insertAt: number): string[] {
  const moving = new Set(group);
  const dragged = ids.filter((id) => moving.has(id));
  if (dragged.length === 0) return [...ids];
  const rest = ids.filter((id) => !moving.has(id));
  const at = Math.min(Math.max(ids.slice(0, Math.max(insertAt, 0)).filter((id) => !moving.has(id)).length, 0), rest.length);
  rest.splice(at, 0, ...dragged);
  return rest;
}

/** Move one card to an insertion point (0..n, counted before the card is removed). */
export const moveCard = (ids: readonly string[], id: string, insertAt: number): string[] => moveCards(ids, [id], insertAt);

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where would a dragged card land? Finds the card nearest the pointer and
 * returns the insertion point just before it or just after it. Works across
 * wrapped rows.
 */
export function dropIndex(boxes: readonly Box[], x: number, y: number): number {
  let best = -1;
  let bestDist = Infinity;
  boxes.forEach((b, i) => {
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const d = (x - cx) ** 2 + ((y - cy) * 2) ** 2; // rows count for more than columns
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  if (best === -1) return 0;
  const b = boxes[best] as Box;
  return x > b.left + b.width / 2 ? best + 1 : best;
}

// ---- Remembering the new-game settings ----

export interface SetupPrefs {
  name: string;
  /** Difficulty of each computer player. */
  opponents: Difficulty[];
  /** Watch only: every seat is a computer. */
  spectate: boolean;
}

/** A 2-player game: you against one Medium computer. */
export const DEFAULT_SETUP: SetupPrefs = { name: 'You', opponents: ['medium'], spectate: false };
export const SETUP_PREFS_KEY = '15steps.setup.v1';
export const MAX_NAME_LENGTH = 16;

const LEVELS: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** How many computer players are allowed: 1 to 5 with you, 2 to 6 when only watching. */
export const opponentRange = (spectate: boolean) => (spectate ? { min: 2, max: 6 } : { min: 1, max: 5 });

/** Turn whatever was stored into valid settings, falling back to the defaults for anything wrong. */
export function sanitizeSetup(raw: unknown): SetupPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const spectate = typeof r.spectate === 'boolean' ? r.spectate : DEFAULT_SETUP.spectate;
  const name = typeof r.name === 'string' ? r.name.slice(0, MAX_NAME_LENGTH) : DEFAULT_SETUP.name;
  const given = Array.isArray(r.opponents) ? r.opponents.filter((x): x is Difficulty => LEVELS.includes(x as Difficulty)) : [];
  const { min, max } = opponentRange(spectate);
  const base = given.length > 0 ? given : DEFAULT_SETUP.opponents;
  const opponents = Array.from({ length: Math.min(Math.max(base.length, min), max) }, (_, i) => base[i] ?? 'medium');
  return { name, opponents, spectate };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage can be blocked entirely (private windows, strict settings)
  }
};

/** The settings the player last used, or the defaults. Never throws. */
export function loadSetupPrefs(store: Store | null = defaultStore()): SetupPrefs {
  try {
    const text = store?.getItem(SETUP_PREFS_KEY);
    return text ? sanitizeSetup(JSON.parse(text)) : { ...DEFAULT_SETUP, opponents: [...DEFAULT_SETUP.opponents] };
  } catch {
    return { ...DEFAULT_SETUP, opponents: [...DEFAULT_SETUP.opponents] };
  }
}

/** Remember the settings for next time. Silently does nothing if storage is unavailable. */
export function saveSetupPrefs(prefs: SetupPrefs, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(SETUP_PREFS_KEY, JSON.stringify(sanitizeSetup(prefs)));
  } catch {
    /* the game still works, it just won't remember */
  }
}

// ---- Options (the Options window): kept across games ----

export interface UiOptions {
  /** Show the Activity window (the log of recent plays) in the top right. */
  showActivity: boolean;
  /** Cards glide, fly and flip into place. */
  animations: boolean;
}
export const DEFAULT_UI_OPTIONS: UiOptions = { showActivity: true, animations: true };
export const UI_OPTIONS_KEY = '15steps.options.v1';

/** Turn whatever was stored into valid options, using the default for anything wrong or missing. */
export function sanitizeUiOptions(raw: unknown): UiOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    showActivity: typeof r.showActivity === 'boolean' ? r.showActivity : DEFAULT_UI_OPTIONS.showActivity,
    animations: typeof r.animations === 'boolean' ? r.animations : DEFAULT_UI_OPTIONS.animations,
  };
}

export function loadUiOptions(store: Store | null = defaultStore()): UiOptions {
  try {
    const text = store?.getItem(UI_OPTIONS_KEY);
    return sanitizeUiOptions(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_UI_OPTIONS };
  }
}

export function saveUiOptions(options: UiOptions, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(UI_OPTIONS_KEY, JSON.stringify(sanitizeUiOptions(options)));
  } catch {
    /* the game still works, it just won't remember */
  }
}

// ---- Saving ----

export const SESSION_SAVE_KEY = '15steps.session.v1';

export function serializeSession(session: Session): string {
  const { events: _events, ...saved } = session;
  return JSON.stringify({ format: '15steps-session', version: 1, session: saved });
}

export function deserializeSession(text: string): Session | null {
  try {
    const data = JSON.parse(text) as { format?: string; version?: number; session?: Session };
    if (data.format !== '15steps-session' || data.version !== 1 || !data.session?.state) return null;
    return { ...data.session, undoStack: data.session.undoStack ?? [] };
  } catch {
    return null;
  }
}


// ---- Watching speed ----

/** How long a computer's move takes, as a multiple of the normal pace: bigger is slower. Index 2 is normal. */
export const SPEED_FACTORS = [2.2, 1.5, 1, 0.65, 0.35, 0.15] as const;
export const DEFAULT_SPEED = 2;
/** The label shown beside the arrows: 1× is normal, 3× is three times as fast. */
export const speedLabel = (index: number): string => {
  const x = 1 / (SPEED_FACTORS[index] ?? 1);
  return `${x < 1 ? x.toFixed(1) : Math.round(x * 10) / 10}×`.replace('.0×', '×');
};
export const SPEED_KEY = '15steps.speed.v1';
export function loadSpeed(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): number {
  try {
    const n = Number(store?.getItem(SPEED_KEY));
    return Number.isInteger(n) && n >= 0 && n < SPEED_FACTORS.length && store?.getItem(SPEED_KEY) !== null ? n : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}
export function saveSpeed(index: number, store: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { store?.setItem(SPEED_KEY, String(index)); } catch { /* not saved: the speed just resets next time */ }
}


// ---- Sound settings ----

export interface SoundSettings {
  soundOn: boolean;
  /** 0 to 1 */
  soundVolume: number;
  musicOn: boolean;
  /** 0 to 1 */
  musicVolume: number;
}
export const DEFAULT_SOUND: SoundSettings = { soundOn: true, soundVolume: 0.7, musicOn: true, musicVolume: 0.4 };
export const SOUND_KEY = '15steps.sound.v1';

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

export function sanitizeSound(raw: unknown): SoundSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    soundOn: typeof r.soundOn === 'boolean' ? r.soundOn : DEFAULT_SOUND.soundOn,
    soundVolume: unit(r.soundVolume, DEFAULT_SOUND.soundVolume),
    musicOn: typeof r.musicOn === 'boolean' ? r.musicOn : DEFAULT_SOUND.musicOn,
    musicVolume: unit(r.musicVolume, DEFAULT_SOUND.musicVolume),
  };
}

export function loadSound(store: Pick<Storage, 'getItem'> | null = defaultStore()): SoundSettings {
  try {
    const text = store?.getItem(SOUND_KEY);
    return sanitizeSound(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SOUND };
  }
}

export function saveSound(settings: SoundSettings, store: Pick<Storage, 'setItem'> | null = defaultStore()): void {
  try {
    store?.setItem(SOUND_KEY, JSON.stringify(sanitizeSound(settings)));
  } catch {
    /* the game still works, it just won't remember */
  }
}
