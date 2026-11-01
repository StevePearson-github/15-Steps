import type { Card, GameState } from '../engine';

/**
 * Card motion. No React in here.
 *
 * The table reports where every face-up card was (`captureCards`, called while
 * rendering, before the DOM changes) and then, once the new layout is in
 * place, `playMotion` works out what moved and animates it:
 *
 * - A card that stays in one area (sorting your hand, lifting a selected card)
 *   glides to its new spot using the CSS `translate`/`scale` properties, so it
 *   never fights the card's own `transform`. Sorting ripples across the hand.
 * - A card that changes area (hand to table, table to hand, discard to hand)
 *   flies there as a ghost copy above everything else; the real card waits,
 *   hidden, until the ghost lands.
 * - A card drawn from the stock flies out of the draw pile face down and
 *   flips as it lands. Cards laid by a computer player shoot out of their hand.
 *   A computer's draw flies a card back into its hand.
 *
 * Elements are tracked by card id (`data-card`), never by DOM node, because
 * React reuses nodes (the discard pile is one node showing different cards).
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardSnap {
  rect: Rect;
  /** The area it sits in (`data-region`): hand, draw, discard, meld-3, reveal-1... */
  region: string;
  /** For the discard pile only: a copy of the face, so a computer drawing it can be shown flying. */
  face?: { node: HTMLElement; vars: Record<string, string> };
}

export interface Snapshot {
  cards: Map<string, CardSnap>;
  /** Where each computer player's hand sat (its last card back), by seat. */
  fans: Map<number, Rect>;
  /** Where each area (`data-region`) sat, so a whole area shifting is not mistaken for its cards moving. */
  regions: Map<string, Rect>;
}

const regionRects = (root: HTMLElement): Map<string, Rect> => {
  const out = new Map<string, Rect>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-region]')) out.set(el.dataset.region as string, toRect(el.getBoundingClientRect()));
  return out;
};

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });
const centre = (r: Rect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const CARD_VARS = ['--card-w', '--card-h', '--back-w'] as const;

/** Whether this browser can animate at all (jsdom cannot) and the player has not asked for less motion. */
export function motionAvailable(): boolean {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false;
  try {
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

function varsOf(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const v of CARD_VARS) {
    const value = cs.getPropertyValue(v).trim();
    if (value) out[v] = value;
  }
  return out;
}

/** Read where everything is right now. Cheap: it only measures. */
export function captureCards(root: HTMLElement): Snapshot {
  const cards = new Map<string, CardSnap>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-card]')) {
    const id = el.dataset.card as string;
    const region = el.closest<HTMLElement>('[data-region]')?.dataset.region ?? '';
    const snap: CardSnap = { rect: toRect(el.getBoundingClientRect()), region };
    if (region === 'discard') snap.face = { node: el.cloneNode(true) as HTMLElement, vars: varsOf(el) };
    cards.set(id, snap);
  }
  return { cards, fans: fansOf(root), regions: regionRects(root) };
}

function fansOf(root: HTMLElement): Map<number, Rect> {
  const fans = new Map<number, Rect>();
  for (const seat of root.querySelectorAll<HTMLElement>('[data-seat]')) {
    const backs = seat.querySelectorAll('.back-card');
    const target = backs.length > 0 ? (backs[backs.length - 1] as Element) : (seat.querySelector('.reveal-hand') ?? seat);
    fans.set(Number(seat.dataset.seat), toRect(target.getBoundingClientRect()));
  }
  return fans;
}

type Where = { kind: 'hand'; seat: number } | { kind: 'stock' } | { kind: 'discard' } | { kind: 'meld' } | { kind: 'unknown' };

function locate(s: GameState, id: string): Where {
  for (let seat = 0; seat < s.players.length; seat++) if (s.players[seat]?.hand.some((c) => c.id === id)) return { kind: 'hand', seat };
  if (s.discard.some((c: Card) => c.id === id)) return { kind: 'discard' };
  if (s.melds.some((m) => m.cards.some((c) => c.id === id))) return { kind: 'meld' };
  if (s.stock.some((c) => c.id === id)) return { kind: 'stock' };
  return { kind: 'unknown' };
}

/** A game that has just been dealt, so a table opened on it can show the deal. */
const isFreshDeal = (s: GameState) =>
  s.melds.length === 0 && s.discard.length === 1 && s.players.every((p) => p.hand.length === s.options.handSize);

export interface PlayOptions {
  root: HTMLElement;
  /** What was on screen before this change (null on first show). */
  snap: Snapshot | null;
  prev: GameState | null;
  next: GameState;
  /** The human's seat, or -1 when only watching. */
  me: number;
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const flightMs = (dist: number) => Math.round(Math.min(560, Math.max(300, 240 + dist * 0.32)));
const ghosts = new Set<HTMLElement>();

function makeGhost(from: HTMLElement, at: Rect, vars: Record<string, string>): HTMLElement {
  const g = from.cloneNode(true) as HTMLElement;
  g.removeAttribute('data-card');
  g.removeAttribute('title');
  g.removeAttribute('aria-label');
  g.setAttribute('aria-hidden', 'true');
  g.tabIndex = -1;
  g.classList.remove('selected', 'clickable', 'dragging');
  g.classList.add('ghost');
  g.querySelector('.badge')?.remove();
  for (const [k, v] of Object.entries(vars)) g.style.setProperty(k, v);
  Object.assign(g.style, {
    position: 'fixed', left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px`,
    margin: '0', zIndex: '1000', pointerEvents: 'none', transition: 'none', transform: 'none',
  });
  document.body.appendChild(g);
  ghosts.add(g);
  return g;
}

const dispose = (g: HTMLElement) => {
  g.remove();
  ghosts.delete(g);
};

/** Keep an element invisible until `ms` have passed. These are tagged "hold" so a re-render leaves them alone. */
function hideFor(el: HTMLElement, ms: number) {
  const a = el.animate([{ visibility: 'hidden' }, { visibility: 'hidden' }], { duration: Math.max(1, ms) });
  a.id = 'hold';
}

interface Flight {
  /** The real element that will be shown at the destination. */
  real: HTMLElement;
  /** What the ghost looks like (a clone of this). */
  look: HTMLElement;
  lookVars: Record<string, string>;
  /** Where the ghost starts and where it lands. */
  from: Rect;
  to: Rect;
  /** Cards from the stock turn face up as they land. */
  flip: boolean;
  delay: number;
  tilt: number;
  /** When the ghost already looks like the destination, it is sized at the destination; otherwise at its own start. */
  base: 'to' | 'from';
}

function fly(f: Flight) {
  const a = centre(f.from);
  const b = centre(f.to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const D = flightMs(dist);
  const FLIP = f.flip ? 110 : 0;
  hideFor(f.real, f.delay + D + FLIP / 2);
  const baseRect = f.base === 'to' ? f.to : f.from;
  const g = makeGhost(f.look, baseRect, f.lookVars);
  // Start where the ghost is built; land at the destination, scaled to its size.
  const start = a;
  const end = b;
  const s0 = f.base === 'to' ? f.from.width / f.to.width : 1;
  const s1 = f.base === 'to' ? 1 : f.to.width / f.from.width;
  const origin = f.base === 'to' ? b : a;
  const dx0 = start.x - origin.x;
  const dy0 = start.y - origin.y;
  const dx1 = end.x - origin.x;
  const dy1 = end.y - origin.y;
  g.animate(
    [
      { translate: `${dx0}px ${dy0}px`, scale: String(s0), rotate: `${f.tilt}deg` },
      { translate: `${dx1}px ${dy1}px`, scale: String(s1), rotate: '0deg' },
    ],
    { duration: D, delay: f.delay, easing: EASE_OUT, fill: 'both' },
  );
  // A little lift in the middle of the flight so it reads as a card thrown through the air.
  g.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], {
    duration: D, delay: f.delay, easing: 'ease-in-out', fill: 'backwards',
  });
  window.setTimeout(() => dispose(g), f.delay + D + FLIP + 400); // never leave one behind
  if (!f.flip) {
    window.setTimeout(() => dispose(g), f.delay + D + 40);
    return;
  }
  const out = g.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: FLIP / 2, delay: f.delay + D, easing: 'ease-in', fill: 'both' });
  const reveal = f.real.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
    duration: FLIP / 2, delay: f.delay + D + FLIP / 2, easing: 'ease-out', fill: 'backwards',
  });
  reveal.id = 'hold';
  out.onfinish = () => dispose(g);
}

/** Compare the old and new screen and start every animation. Call it right after the DOM updates, before the browser paints. */
export function playMotion({ root, snap, prev, next, me }: PlayOptions): void {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-card]'));
  const newRound = !!prev && prev.round !== next.round;
  const dealing = newRound || (!prev && isFreshDeal(next));
  const before = dealing ? new Map<string, CardSnap>() : (snap?.cards ?? new Map<string, CardSnap>());

  // Measure the finished layout: stop earlier glides and switch off CSS transitions while reading.
  for (const el of els) {
    el.style.transition = 'none';
    for (const a of el.getAnimations()) if (a.id === 'motion') a.cancel();
  }
  const now = els.map((el) => ({
    el,
    id: el.dataset.card as string,
    rect: toRect(el.getBoundingClientRect()),
    region: el.closest<HTMLElement>('[data-region]')?.dataset.region ?? '',
    held: el.getAnimations().some((a) => a.id === 'hold'),
  }));
  for (const el of els) el.style.transition = '';

  const draw = root.querySelector<HTMLElement>('[data-region="draw"] .card');
  const drawRect = draw ? toRect(draw.getBoundingClientRect()) : null;
  const drawVars = draw ? varsOf(draw) : {};
  const fansNow = fansOf(root);
  const regionsNow = regionRects(root);
  const regionsBefore = snap?.regions ?? new Map<string, Rect>();
  const fansBefore = snap?.fans ?? new Map<number, Rect>();

  const glides: { el: HTMLElement; dx: number; dy: number; scale: number; dist: number; x: number }[] = [];
  let launched = 0;
  const nextDelay = () => Math.min(launched++ * 55, 330);

  for (const c of now) {
    if (c.held) continue;
    const was = before.get(c.id);
    if (was) {
      const a = centre(was.rect);
      const b = centre(c.rect);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (was.region === c.region) {
        // Only the card's own movement inside its area counts; if the whole area shifted, the card went with it.
        const r0 = regionsBefore.get(c.region);
        const r1 = regionsNow.get(c.region);
        const dx = a.x - b.x - (r0 && r1 ? r0.left - r1.left : 0);
        const dy = a.y - b.y - (r0 && r1 ? r0.top - r1.top : 0);
        const own = Math.hypot(dx, dy);
        if (own > 0.5 || Math.abs(was.rect.width - c.rect.width) > 0.5) {
          glides.push({ el: c.el, dx, dy, scale: was.rect.width / c.rect.width, dist: own, x: c.rect.left });
        }
      } else if (dist > 4) {
        fly({
          real: c.el, look: c.el, lookVars: varsOf(c.el), from: was.rect, to: c.rect, flip: false,
          delay: nextDelay(), tilt: 0, base: 'to',
        });
      }
      continue;
    }
    // A card that was not on screen before: where did it come from?
    if (!prev && !dealing) continue;
    const from = prev ? locate(prev, c.id) : ({ kind: 'stock' } as Where);
    const origin = dealing ? ({ kind: 'stock' } as Where) : from;
    if (origin.kind === 'hand' && origin.seat !== me) {
      const src = fansBefore.get(origin.seat) ?? fansNow.get(origin.seat);
      if (src) {
        fly({
          real: c.el, look: c.el, lookVars: varsOf(c.el), from: src, to: c.rect, flip: false,
          delay: nextDelay(), tilt: ((launched * 37) % 17) - 8, base: 'to',
        });
      }
    } else if ((origin.kind === 'stock' || origin.kind === 'unknown') && draw && drawRect && c.region !== 'discard' && c.region !== 'draw') {
      fly({
        real: c.el, look: draw, lookVars: drawVars, from: drawRect, to: c.rect, flip: true,
        delay: nextDelay(), tilt: dealing ? ((launched * 29) % 13) - 6 : 0, base: 'from',
      });
    }
  }

  // Sorting and nudging: glide, rippling from the left when several cards move.
  glides.sort((p, q) => p.x - q.x);
  const rippling = glides.filter((g) => g.dist >= 24).length > 1;
  let rank = 0;
  for (const g of glides) {
    const far = g.dist >= 24;
    const duration = far ? flightMs(g.dist) * 0.8 : 130;
    const delay = far && rippling ? Math.min(rank++ * 24, 300) : 0;
    const a = g.el.animate(
      [
        { translate: `${g.dx}px ${g.dy}px`, scale: String(g.scale) },
        { translate: '0px 0px', scale: '1' },
      ],
      { duration, delay, easing: far ? EASE_OUT : 'ease', fill: 'backwards' },
    );
    a.id = 'motion';
  }

  // A computer player drew: fly a card from the pile (or the discard) into its hand.
  if (prev && !newRound) {
    next.players.forEach((p, seat) => {
      if (seat === me) return;
      const old = prev.players[seat];
      if (!old || p.hand.length <= old.hand.length) return;
      const oldIds = new Set(old.hand.map((c) => c.id));
      const drawn = p.hand.filter((c) => !oldIds.has(c.id));
      const seatEl = root.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
      const backs = seatEl?.querySelectorAll<HTMLElement>('.back-card');
      const landing = backs && backs.length > 0 ? (backs[backs.length - 1] as HTMLElement) : null;
      for (const card of drawn) {
        const discardFace = snap?.cards.get(card.id);
        const delay = nextDelay();
        if (landing) {
          const to = toRect(landing.getBoundingClientRect());
          if (discardFace?.face) {
            fly({ real: landing, look: discardFace.face.node, lookVars: discardFace.face.vars, from: discardFace.rect, to, flip: true, delay, tilt: 0, base: 'from' });
          } else if (drawRect) {
            fly({ real: landing, look: landing, lookVars: varsOf(landing), from: drawRect, to, flip: false, delay, tilt: 0, base: 'to' });
          }
        }
      }
    });
  }
}
