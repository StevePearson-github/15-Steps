import { type Card, type GameState, type Meld, type Phase, createGame } from '../src/engine';

const RANKS: Record<string, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13,
};

/** Parse "5S", "TH.2", "X" (joker). Deck number defaults to 1 and is part of the id. */
export function card(token: string): Card {
  const [face = '', deck = '1'] = token.split('.');
  const id = `${face}.${deck}`;
  if (face === 'X') return { id, kind: 'joker' };
  const rank = RANKS[face.slice(0, -1)];
  const suit = face.slice(-1);
  if (!rank || !'SHDC'.includes(suit)) throw new Error(`Bad card token ${token}`);
  return { id, kind: 'standard', rank, suit: suit as 'S' | 'H' | 'D' | 'C' };
}

export function cards(tokens: string): Card[] {
  return tokens.trim().split(/\s+/).filter(Boolean).map(card);
}

/** Ids for use in actions: ids("5S 5H") -> ["5S.1","5H.1"]. */
export function ids(tokens: string): string[] {
  return cards(tokens).map((c) => c.id);
}

export interface Scenario {
  hands: string[];
  steps?: number[];
  scores?: number[];
  baseLaid?: boolean[];
  stock?: string;
  discard?: string;
  melds?: Meld[];
  phase?: Phase;
  current?: number;
}

/** Build a game state for a rule-specific test (card conservation is not enforced). */
export function scenario(sc: Scenario): GameState {
  const g = createGame({ playerNames: sc.hands.map((_, i) => `P${i}`), seed: 1 });
  g.players.forEach((p, i) => {
    p.hand = cards(sc.hands[i] ?? '');
    p.step = sc.steps?.[i] ?? 1;
    p.score = sc.scores?.[i] ?? 0;
    p.baseLaid = sc.baseLaid?.[i] ?? false;
  });
  g.stock = cards(sc.stock ?? '5S.2 6S.2 7S.2');
  g.discard = cards(sc.discard ?? '9C.2');
  g.melds = sc.melds ?? [];
  g.nextMeldId = g.melds.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  g.phase = sc.phase ?? 'draw';
  g.current = sc.current ?? 0;
  return g;
}

export function set(id: number, owner: number, rank: number, tokens: string): Meld {
  const cs = cards(tokens);
  return { id, owner, kind: cs.length === 2 ? 'pair' : 'set', rank, cards: cs };
}

export function run(id: number, owner: number, suit: 'S' | 'H' | 'D' | 'C', start: number, tokens: string): Meld {
  return { id, owner, kind: 'run', suit, start, cards: cards(tokens) };
}
