import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Card } from '../engine';
import { CardView } from './CardView';
import { type Box, cardLabel, dropIndex, moveCards } from './controller';

interface HandProps {
  cards: Card[];
  selected: string[];
  /** Whether pressing a card selects it. */
  canSelect: boolean;
  onToggle: (id: string) => void;
  /** Replace the selection (used by the Shift+drag selection box). */
  onSelect: (ids: string[]) => void;
  /** Move these cards (kept in their current order) to an insertion point (0..cards.length). */
  onMove: (ids: string[], insertAt: number) => void;
}

/** What the table can ask the hand to do. */
export interface HandHandle {
  /** Start a selection box from a press on empty board (outside the hand row). */
  beginBox: (e: React.PointerEvent) => void;
}

interface Drag {
  /** The cards being carried, in hand order. One card, or the whole selection. */
  ids: string[];
  /** The card under the pointer. */
  anchor: string;
  /** Pointer travel since the press. */
  dx: number;
  dy: number;
  /** Insertion point, 0..cards.length, measured against the layout at the start of the drag. */
  over: number;
}

interface Marquee {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DRAG_THRESHOLD = 5;
/** How far each card in a carried group is fanned from the next, as a share of a card's width. */
const FAN = 0.3;

const intersects = (b: Box, r: { left: number; top: number; right: number; bottom: number }) =>
  b.left < r.right && b.left + b.width > r.left && b.top < r.bottom && b.top + b.height > r.top;

/**
 * The player's hand.
 *
 * - Press and drag a card to slide it elsewhere. If it is one of several
 *   selected cards, the whole selection is carried together.
 * - Press without moving to select it.
 * - Dragging from empty space (in the hand row or on the board around it)
 *   draws a selection box that selects every card it touches. Holding Shift
 *   adds to the current selection instead of replacing it, and also works
 *   starting on a card. Shift+click adds or removes one card.
 * - Keyboard: Enter/Space selects, Shift+Left/Right moves the card, or the
 *   whole selection if the card is part of one.
 *
 * The layout is measured once when a drag starts and the cards are only moved
 * with transforms, so what is under the pointer never shifts mid-drag.
 */
export const Hand = forwardRef<HandHandle, HandProps>(function Hand({ cards, selected, canSelect, onToggle, onSelect, onMove }, ref) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const slots = useRef<Box[]>([]);
  const stop = useRef<(() => void) | null>(null);
  const latest = useRef({ cards, selected, canSelect, onToggle, onSelect, onMove });
  latest.current = { cards, selected, canSelect, onToggle, onSelect, onMove };

  useEffect(() => () => stop.current?.(), []);

  const measure = (): Box[] =>
    Array.from(rowRef.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });

  /**
   * Start a press on a card (`id`) or on empty space (`id` null). A press on
   * empty space, or any press with Shift held, draws a selection box.
   */
  const begin = (e: React.PointerEvent, id: string | null, index: number) => {
    if (e.button !== 0) return;
    stop.current?.();
    const l = latest.current;
    const ids = l.cards.map((c) => c.id);
    const layout = measure();
    slots.current = layout;
    const start = { x: e.clientX, y: e.clientY };
    const boxing = e.shiftKey || id === null;
    // Shift adds to the current selection; a plain box starts afresh.
    const baseSelection = e.shiftKey ? [...l.selected] : [];
    const area = rowRef.current?.getBoundingClientRect();
    // Pressing a selected card carries the whole selection; any other card travels alone.
    const group = id && !boxing && l.selected.length > 1 && l.selected.includes(id) ? ids.filter((x) => l.selected.includes(x)) : id ? [id] : [];
    let moved = false;
    let over = index;

    const onMoveEvt = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      if (boxing) {
        const rect = {
          left: Math.min(start.x, ev.clientX),
          top: Math.min(start.y, ev.clientY),
          right: Math.max(start.x, ev.clientX),
          bottom: Math.max(start.y, ev.clientY),
        };
        const hit = ids.filter((_, i) => layout[i] && intersects(layout[i] as Box, rect));
        latest.current.onSelect([...new Set([...baseSelection, ...hit])]);
        setMarquee({ left: rect.left - (area?.left ?? 0), top: rect.top - (area?.top ?? 0), width: rect.right - rect.left, height: rect.bottom - rect.top });
      } else if (id) {
        over = dropIndex(layout, ev.clientX, ev.clientY);
        setDrag({ ids: group, anchor: id, dx, dy, over });
      }
    };
    const finish = (commit: boolean) => {
      stop.current?.();
      setDrag(null);
      setMarquee(null);
      if (!commit) return;
      const now = latest.current;
      if (boxing) {
        if (!moved && id) now.onToggle(id); // Shift+click on a card
      } else if (moved && id) now.onMove(group, over);
      else if (id && now.canSelect) now.onToggle(id);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', onMoveEvt);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    stop.current = () => {
      window.removeEventListener('pointermove', onMoveEvt);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stop.current = null;
    };
  };

  useImperativeHandle(ref, () => ({ beginBox: (e) => begin(e, null, -1) }));

  const ids = cards.map((c) => c.id);
  // Where every card ends up if the drag were dropped now.
  const finalIds = drag ? moveCards(ids, drag.ids, drag.over) : ids;

  const styleFor = (c: Card, i: number) => {
    if (!drag) return undefined;
    // A selected card sits raised (--card-lift in the stylesheet); keep it raised while things move.
    const raised = selected.includes(c.id);
    const move = (x: number, y: number) =>
      ({ transform: raised ? `translate(${x}px, calc(${y}px - var(--card-lift)))` : `translate(${x}px, ${y}px)` });
    const here = slots.current[i];
    if (!here) return undefined;
    const k = drag.ids.indexOf(c.id);
    if (k !== -1) {
      // Carried cards gather in a fan around the pointer, in their hand order.
      const anchorSlot = slots.current[ids.indexOf(drag.anchor)] ?? here;
      const step = anchorSlot.width * FAN;
      const left = anchorSlot.left + drag.dx + (k - drag.ids.indexOf(drag.anchor)) * step;
      const top = anchorSlot.top + drag.dy;
      return move(left - here.left, top - here.top);
    }
    const to = slots.current[finalIds.indexOf(c.id)];
    return to ? move(to.left - here.left, to.top - here.top) : undefined;
  };

  return (
    <div
      className={`hand${drag ? ' dragging-active' : ''}`}
      ref={rowRef}
      role="group"
      aria-label="Your hand"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && e.pointerType !== 'touch') begin(e, null, -1);
      }}
    >
      {cards.map((c, i) => (
        <CardView
          key={c.id}
          card={c}
          selected={selected.includes(c.id)}
          selectable={canSelect}
          label={cardLabel(c)}
          className={drag?.ids.includes(c.id) ? 'dragging' : ''}
          style={styleFor(c, i)}
          // A click with detail 0 comes from the keyboard. Mouse and touch are handled on pointer release.
          onClick={(e) => canSelect && e.detail === 0 && onToggle(c.id)}
          buttonProps={{
            onPointerDown: (e) => begin(e, c.id, i),
            onKeyDown: (e) => {
              if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
              e.preventDefault();
              // Move the whole selection if this card is part of one, else just this card.
              const group = selected.length > 1 && selected.includes(c.id) ? ids.filter((x) => selected.includes(x)) : [c.id];
              const first = ids.indexOf(group[0] as string);
              const last = ids.indexOf(group[group.length - 1] as string);
              const target = e.key === 'ArrowLeft' ? first - 1 : last + 2;
              if (target >= 0 && target <= cards.length) onMove(group, target);
              requestAnimationFrame(() => rowRef.current?.querySelector<HTMLElement>(`[data-card="${c.id}"]`)?.focus());
            },
          }}
        />
      ))}
      {marquee && <div className="marquee" aria-hidden="true" style={marquee} />}
    </div>
  );
});
