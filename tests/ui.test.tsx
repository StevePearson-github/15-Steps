// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/ui/App';
import { Setup } from '../src/ui/Setup';
import { describeStep as describeStepText } from '../src/ui/controller';
import { SETUP_PREFS_KEY, type SetupOptions } from '../src/ui/controller';
import { Table } from '../src/ui/Table';
import { useState } from 'react';
import { type Action, applyAction } from '../src/engine';
import { type Session, apply, undo } from '../src/ui/controller';
import { run, scenario, set } from './helpers';

// jsdom has no PointerEvent: a MouseEvent with a pointer id is enough for our handlers.
if (!('PointerEvent' in window)) {
  (window as unknown as { PointerEvent: unknown }).PointerEvent = class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const seats = [
  { name: 'Sam', kind: 'human' as const },
  { name: 'Ada', kind: 'medium' as const },
];

function tableFor(sc: Parameters<typeof scenario>[0], actions: Action[] = [], reply: string | null = null) {
  const session: Session = { state: scenario({ phase: 'play', ...sc }), seats, log: ['Round 1. Ada deals.'], undoStack: [] };
  const onAction = (a: Action) => (actions.push(a), reply);
  render(<Table session={session} onAction={onAction} onNewGame={() => {}} />);
  return actions;
}
const card = (id: string) => document.querySelector(`[data-card="${id}"]`) as HTMLElement;
const clickCards = (...ids: string[]) => ids.forEach((id) => fireEvent.click(card(id)));

describe('starting a game', () => {
  it('starts from the setup screen and reaches the human’s first turn', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123);
    render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => expect(screen.getByText(/Your turn — draw a card/)).toBeTruthy(), { timeout: 3000 });
    expect(document.querySelectorAll('.hand .card')).toHaveLength(13);
  });

  it('draws, then discards, and the computer takes its turn', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123);
    render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => screen.getByText(/draw a card/));
    fireEvent.click(document.querySelector('.piles .card.back') as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('.hand .card')).toHaveLength(14));
    expect(document.querySelector('.status-pill')).toBeNull(); // the draw prompt goes away once you have drawn
    fireEvent.click(document.querySelector('.hand .card') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Discard selected' }));
    await waitFor(() => expect(document.querySelectorAll('.hand .card')).toHaveLength(13));
    await waitFor(() => screen.getByText(/draw a card/), { timeout: 3000 });
  });

  it('has the speed arrows on screen in a game you are playing, not only when watching', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => screen.getByText(/draw a card/));
    expect(screen.getByRole('group', { name: 'Speed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Slower' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Faster' })).toBeTruthy();
  });

  it('offers to continue a saved game', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const first = render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => screen.getByText(/draw a card/));
    first.unmount();
    render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue saved game' }));
    await waitFor(() => screen.getByText(/draw a card/));
    expect(document.querySelectorAll('.hand .card')).toHaveLength(13);
  });

  it('can watch computers play a round without a human', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByLabelText(/Watch the computer players/));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => expect(screen.getByText(/Round 2/)).toBeTruthy(), { timeout: 20000 });
  }, 25000);
});

describe('playing a turn', () => {
  it('draws from the stock or the discard', () => {
    const actions = tableFor({ hands: ['3S 4S', '5H 6H'], phase: 'draw' });
    fireEvent.click(document.querySelector('.piles .card.back') as HTMLElement);
    fireEvent.click(document.querySelector('.piles [data-card="9C.2"]') as HTMLElement);
    expect(actions).toEqual([{ type: 'drawStock' }, { type: 'drawDiscard' }]);
  });

  it('lays down a base by adding melds and pressing Lay down base', () => {
    const actions = tableFor({ hands: ['7S 7H 7D 8S 8H 8D 4C 9C', '5H 6H'] });
    const lay = screen.getByRole('button', { name: 'Lay down base' }) as HTMLButtonElement;
    expect(lay.disabled).toBe(true);
    clickCards('7S.1', '7H.1', '7D.1');
    fireEvent.click(screen.getByRole('button', { name: 'Add as meld' }));
    expect(screen.getByText('Set of 3: 7s')).toBeTruthy();
    expect(lay.disabled).toBe(true);
    clickCards('8S.1', '8H.1', '8D.1');
    fireEvent.click(screen.getByRole('button', { name: 'Add as meld' }));
    expect(lay.disabled).toBe(false);
    fireEvent.click(lay);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'layBase', melds: [{ kind: 'set', rank: 7 }, { kind: 'set', rank: 8 }] });
  });

  it('asks which end a wild takes in a run when you lay the base, instead of guessing', () => {
    // Step 8: two runs of 4. 10-J-Q + joker can be 9-Q or 10-K, and the player wants the king.
    const actions = tableFor({ hands: ['TD JD QD X 3C 4C 5C 8S 2H', '5H 6H'], steps: [8, 1] });
    clickCards('TD.1', 'JD.1', 'QD.1', 'X.1', '3C.1', '4C.1', '5C.1', '2H.1');
    fireEvent.click(screen.getByRole('button', { name: 'Lay down base' }));
    expect(actions).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Which run is this?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /10–K/ }));
    // the clubs run (3-4-5 with a wild 2) is ambiguous too, so it is asked about next
    fireEvent.click(screen.getByRole('button', { name: /3–6/ }));
    expect(actions[0]).toMatchObject({ type: 'layBase' });
    const runs = (actions[0] as { melds: { kind: string; suit: string; start: number }[] }).melds;
    expect(runs.find((m) => m.suit === 'D')?.start).toBe(10);
  });

  it('suggests a base by selecting its cards in your hand, then lays it down', () => {
    const actions = tableFor({ hands: ['7S 7H 7D 8S 8H 8D 4C 9C', '5H 6H'] });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest base' }));
    // Nothing disappears: all eight cards are still in the hand, the six base cards are raised.
    expect(document.querySelectorAll('.hand .card')).toHaveLength(8);
    const raised = Array.from(document.querySelectorAll('.hand .card[aria-pressed="true"]')).map((el) => el.getAttribute('data-card'));
    expect(raised.sort()).toEqual(['7D.1', '7H.1', '7S.1', '8D.1', '8H.1', '8S.1']);
    expect(document.querySelectorAll('.staged')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Lay down base' }));
    expect(actions[0]?.type).toBe('layBase');
  });

  it('a suggestion can be adjusted: deselect a card and the base is no longer ready', () => {
    tableFor({ hands: ['7S 7H 7D 8S 8H 8D 4C 9C', '5H 6H'] });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest base' }));
    expect((screen.getByRole('button', { name: 'Lay down base' }) as HTMLButtonElement).disabled).toBe(false);
    clickCards('8D.1');
    expect((screen.getByRole('button', { name: 'Lay down base' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when there is no base to suggest, and selects nothing', () => {
    tableFor({ hands: ['7S 8H 9D 3S 4H 6D JC KC', '5H 6H'] });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest base' }));
    expect(screen.getByRole('alert').textContent).toMatch(/No base to suggest/);
    expect(document.querySelectorAll('.hand .card[aria-pressed="true"]')).toHaveLength(0);
  });

  it('asks what ambiguous cards are, and uses the answer', () => {
    const actions = tableFor({ hands: ['5H 6H X 4C 9C', '5H 6H'], baseLaid: [true] });
    clickCards('5H.1', '6H.1', 'X.1');
    fireEvent.click(screen.getByRole('button', { name: 'Lay down selected' }));
    const dialog = screen.getByRole('dialog');
    const options = within(dialog).getAllByRole('button').filter((b) => /Run/.test(b.textContent ?? ''));
    expect(options.length).toBe(2);
    fireEvent.click(options[0] as HTMLElement);
    expect(actions[0]).toMatchObject({ type: 'layMeld', meld: { kind: 'run', suit: 'H' } });
  });

  it('explains when the selection is not a meld', () => {
    tableFor({ hands: ['5H 9S 7C 4C 9C', '5H 6H'], baseLaid: [true] });
    clickCards('5H.1', '9S.1', '7C.1');
    fireEvent.click(screen.getByRole('button', { name: 'Lay down selected' }));
    expect(screen.getByRole('alert').textContent).toMatch(/valid set, run or pair/);
  });

  it('builds onto a run from either end', () => {
    const actions = tableFor({
      hands: ['8H 9H 3C 9C', '5H 6H'], baseLaid: [true],
      melds: [run(1, 1, 'H', 5, '5H 6H 7H'), set(2, 1, 4, '4S 4D 4C')],
    });
    clickCards('9H.1', '8H.1');
    fireEvent.click(screen.getByRole('button', { name: 'add high ▶' }));
    expect(actions[0]).toEqual({ type: 'build', meldId: 1, cardIds: ['8H.1', '9H.1'], side: 'high' });
  });

  it('builds onto a set', () => {
    const actions = tableFor({
      hands: ['4H 3C 9C', '5H 6H'], baseLaid: [true], melds: [set(2, 1, 4, '4S 4D 4C')],
    });
    clickCards('4H.1');
    fireEvent.click(screen.getByRole('button', { name: '+ add' }));
    expect(actions[0]).toEqual({ type: 'build', meldId: 2, cardIds: ['4H.1'] });
  });

  it('shows the engine’s error message', () => {
    tableFor({ hands: ['4H 3C', '5H 6H'] }, [], 'Lay down your base first');
    clickCards('4H.1');
    fireEvent.click(screen.getByRole('button', { name: 'Discard selected' }));
    expect(screen.getByRole('alert').textContent).toBe('Lay down your base first');
  });

  it('shows the goal for the current step', () => {
    tableFor({ hands: ['4H 3C', '5H 6H'], steps: [7] });
    expect(screen.getByText(/one set of 4 \+ one run of 3/)).toBeTruthy();
  });

  it('does not let you act on the computer’s turn', () => {
    tableFor({ hands: ['4H 3C', '5H 6H'], current: 1 });
    // the buttons stay on screen, greyed out, so they never seem to come and go
    expect((screen.getByRole('button', { name: 'Discard selected' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Lay down base' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('end of round', () => {
  it('shows penalties and starts the next round', () => {
    const actions: Action[] = [];
    const state = scenario({ hands: ['3S', 'X 5H'], baseLaid: [true, false], phase: 'play' });
    const session: Session = { state, seats, log: [], undoStack: [] };
    // Go out through the real engine so the summary is genuine.
    const done = applyAction(state, { type: 'discard', cardId: '3S.1' });
    if (!done.ok) throw new Error(done.error);
    render(<Table session={{ ...session, state: done.state }} onAction={(a) => (actions.push(a), null)} onNewGame={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Round over' });
    // Ada held a joker (50) and a 5 (5): 55 penalty, and 55 total.
    expect(within(dialog).getAllByText('55')).toHaveLength(2);
    expect(within(dialog).getByText('Ada')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next round' }));
    expect(actions).toEqual([{ type: 'nextRound' }]);
  });
});

describe('arranging your hand', () => {
  const handOrder = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card'));
  /** Lay the hand out in a row, 70px apart, so the drag maths has something to measure. */
  const layOut = () =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const i = Array.from(document.querySelectorAll('.hand [data-card]')).indexOf(this);
      return { left: i * 70, top: 0, width: 60, height: 80, right: i * 70 + 60, bottom: 80, x: i * 70, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  const drag = (id: string, from: number, to: number) => {
    fireEvent.pointerDown(card(id), { clientX: from, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card(id), { clientX: (from + to) / 2, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(card(id), { clientX: to, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(card(id), { clientX: to, clientY: 40, pointerId: 1 });
  };

  it('starts sorted by suit', () => {
    tableFor({ hands: ['JS 3S TS 9S', '5H'] });
    expect(handOrder()).toEqual(['3S.1', '9S.1', 'TS.1', 'JS.1']);
  });

  it('slides a card to a new place when you drag it', () => {
    layOut();
    tableFor({ hands: ['JS 3S TS 9S', '5H'] });
    drag('3S.1', 30, 150); // drop between the 2nd and 3rd cards
    expect(handOrder()).toEqual(['9S.1', '3S.1', 'TS.1', 'JS.1']);
    drag('JS.1', 240, 5); // all the way to the front
    expect(handOrder()).toEqual(['JS.1', '9S.1', '3S.1', 'TS.1']);
  });

  it('dragging does not select the card, but a plain press does', () => {
    layOut();
    tableFor({ hands: ['JS 3S TS 9S', '5H'] });
    drag('3S.1', 30, 150);
    expect(card('3S.1').getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(card('TS.1'), { clientX: 100, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerUp(card('TS.1'), { clientX: 100, clientY: 40, pointerId: 1 });
    expect(card('TS.1').getAttribute('aria-pressed')).toBe('true');
    expect(handOrder()).toEqual(['9S.1', '3S.1', 'TS.1', 'JS.1']);
  });

  it('lets you rearrange even when it is not your turn', () => {
    layOut();
    tableFor({ hands: ['JS 3S TS 9S', '5H'], current: 1 });
    drag('3S.1', 30, 150);
    expect(handOrder()).toEqual(['9S.1', '3S.1', 'TS.1', 'JS.1']);
    // You can select cards while waiting too (no actions are offered until your turn).
    clickCards('3S.1');
    expect(card('3S.1').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Discard selected' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves the focused card with Shift+arrow keys', () => {
    tableFor({ hands: ['JS 3S TS 9S', '5H'] });
    fireEvent.keyDown(card('3S.1'), { key: 'ArrowRight', shiftKey: true });
    expect(handOrder()).toEqual(['9S.1', '3S.1', 'TS.1', 'JS.1']);
    fireEvent.keyDown(card('3S.1'), { key: 'ArrowLeft', shiftKey: true });
    expect(handOrder()).toEqual(['3S.1', '9S.1', 'TS.1', 'JS.1']);
    fireEvent.keyDown(card('3S.1'), { key: 'ArrowLeft', shiftKey: true }); // already first
    expect(handOrder()).toEqual(['3S.1', '9S.1', 'TS.1', 'JS.1']);
  });

  it('keeps your arrangement when you draw: the new card goes on the end', () => {
    layOut();
    const mk = (hand: string) => ({ state: scenario({ phase: 'play', hands: [hand, '5H'] }), seats, log: [], undoStack: [] }) as Session;
    const view = (s: Session) => <Table session={s} onAction={() => null} onNewGame={() => {}} />;
    const { rerender } = render(view(mk('JS 3S TS 9S')));
    drag('JS.1', 240, 5);
    expect(handOrder()).toEqual(['JS.1', '3S.1', '9S.1', 'TS.1']);
    rerender(view(mk('JS 3S TS 9S AH')));
    expect(handOrder()).toEqual(['JS.1', '3S.1', '9S.1', 'TS.1', 'AH.1']);
    rerender(view(mk('JS 3S 9S AH'))); // the 10 was discarded
    expect(handOrder()).toEqual(['JS.1', '3S.1', '9S.1', 'AH.1']);
  });

  it('sorts on request, by suit or by rank', () => {
    layOut();
    tableFor({ hands: ['JS 3H TS 9S', '5H'] });
    drag('JS.1', 0, 300);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by rank' }));
    expect(handOrder()).toEqual(['3H.1', '9S.1', 'TS.1', 'JS.1']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by suit' }));
    expect(handOrder()).toEqual(['9S.1', 'TS.1', 'JS.1', '3H.1']);
  });

  it('cards laid into the base are hidden, and come back where they were', () => {
    layOut();
    tableFor({ hands: ['7S 7H 7D 8S 4C', '5H'] });
    drag('4C.1', 280, 5); // 4C to the front
    const before = handOrder();
    expect(before[0]).toBe('4C.1');
    clickCards('7S.1', '7H.1', '7D.1');
    fireEvent.click(screen.getByRole('button', { name: 'Add as meld' }));
    expect(handOrder()).toEqual(['4C.1', '8S.1']);
  });
});

describe('right-click menu', () => {
  const handOrder = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const open = (target: Element = document.querySelector('.hand') as Element) =>
    fireEvent.contextMenu(target, { clientX: 100, clientY: 100 });
  /** Choose a sort in the second level of the menu. */
  const pick = (sort: string, direction: 'Ascending' | 'Descending') => {
    fireEvent.click(screen.getByRole('menuitem', { name: sort }));
    fireEvent.click(within(screen.getByRole('menu', { name: sort })).getByRole('menuitem', { name: direction }));
  };

  it('opens on right-click with the sort options', () => {
    tableFor({ hands: ['9S 9H 5D 6D 7D 8C', '5H'] });
    open();
    const menu = screen.getByRole('menu', { name: 'Arrange your hand' });
    const items = within(menu).getAllByRole('menuitem').map((b) => b.textContent?.replace('▸', ''));
    expect(items).toEqual(['Smart sort', 'Sort by sets', 'Sort by runs', 'Sort by suit', 'Sort by rank', 'Show the 15 steps', 'Undo last play', 'Clear selection']);
  });

  it('opens when right-clicking a card, too', () => {
    tableFor({ hands: ['9S 9H 5D', '5H'] });
    open(card('9S.1'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('sorts by sets, then by runs, and closes', () => {
    tableFor({ hands: ['5D 9S 6D 9H 7D 8C 9D', '5H'] });
    open();
    pick('Sort by sets', 'Ascending');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(handOrder()).toEqual(['9S', '9H', '9D', '5D', '6D', '7D', '8C']);
    open();
    pick('Sort by runs', 'Ascending');
    // the diamond run first, then loose cards from low to high
    expect(handOrder()).toEqual(['5D', '6D', '7D', '8C', '9S', '9H', '9D']);
  });

  it('can clear the selection', () => {
    tableFor({ hands: ['9S 9H 5D', '5H'] });
    open();
    expect((screen.getByRole('menuitem', { name: 'Clear selection' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    clickCards('9S.1');
    expect(card('9S.1').getAttribute('aria-pressed')).toBe('true');
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear selection' }));
    expect(card('9S.1').getAttribute('aria-pressed')).toBe('false');
  });

  it('closes on Escape and on a click elsewhere', () => {
    tableFor({ hands: ['9S 9H 5D', '5H'] });
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('works when it is not your turn', () => {
    tableFor({ hands: ['5D 9S 9H', '5H'], current: 1 });
    open();
    pick('Sort by sets', 'Ascending');
    expect(handOrder()).toEqual(['9S', '9H', '5D']);
  });

  it('the sort links under the hand do the same', () => {
    tableFor({ hands: ['5D 9S 9H', '5H'] });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by sets' }));
    expect(handOrder()).toEqual(['9S', '9H', '5D']);
  });
});

describe('dragging is forgiving', () => {
  const handOrder = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const SLOT = 70;
  /** Like a real browser: a card's rect includes its own transform, so the dragged card sits under the pointer. */
  const realisticRects = () =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const i = Array.from(document.querySelectorAll('.hand [data-card]')).indexOf(this);
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((this as HTMLElement).style.transform ?? '');
      const dx = m ? Number(m[1]) : 0;
      const dy = m ? Number(m[2]) : 0;
      return { left: i * SLOT + dx, top: dy, width: 60, height: 80, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });

  it('drops in the right slot even though the dragged card is under the pointer', () => {
    realisticRects();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    // Press the first card, drag in several small steps to the right half of the 4th card (slot 3 spans 210-270).
    fireEvent.pointerDown(card('3S.1'), { clientX: 30, clientY: 40, button: 0, pointerId: 1 });
    for (const x of [60, 120, 180, 230, 262]) fireEvent.pointerMove(card('3S.1'), { clientX: x, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(card('3S.1'), { clientX: 262, clientY: 40, pointerId: 1 });
    expect(handOrder()).toEqual(['4S', '5S', '6S', '3S', '7S', '8S']);
  });

  it('works even if the pointer wanders a long way off the cards (nearest slot wins)', () => {
    realisticRects();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    fireEvent.pointerDown(card('8S.1'), { clientX: 380, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card('8S.1'), { clientX: 200, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(card('8S.1'), { clientX: 20, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(card('8S.1'), { clientX: 20, clientY: 300, pointerId: 1 });
    expect(handOrder()).toEqual(['8S', '3S', '4S', '5S', '6S', '7S']);
  });

  it('the other cards slide aside while you drag', () => {
    realisticRects();
    tableFor({ hands: ['3S 4S 5S 6S', '5H'] });
    fireEvent.pointerDown(card('3S.1'), { clientX: 30, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card('3S.1'), { clientX: 120, clientY: 40, pointerId: 1 });
    fireEvent.pointerMove(card('3S.1'), { clientX: 180, clientY: 40, pointerId: 1 }); // right half of slot 2
    // 3S is heading to slot 2: 4S and 5S each slide one slot left.
    expect(card('4S.1').style.transform).toBe('translate(-70px, 0px)');
    expect(card('5S.1').style.transform).toBe('translate(-70px, 0px)');
    expect(card('6S.1').style.transform).toBe('translate(0px, 0px)');
    expect(card('3S.1').style.transform).toBe('translate(150px, 0px)');
    fireEvent.pointerUp(card('3S.1'), { clientX: 180, clientY: 40, pointerId: 1 });
    expect(handOrder()).toEqual(['4S', '5S', '3S', '6S']);
    expect(card('4S.1').style.transform).toBe(''); // nothing is left shifted
  });

  it('a tiny wobble while clicking is still a click, not a drag', () => {
    realisticRects();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    fireEvent.pointerDown(card('4S.1'), { clientX: 100, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card('4S.1'), { clientX: 102, clientY: 41, pointerId: 1 });
    fireEvent.pointerUp(card('4S.1'), { clientX: 102, clientY: 41, pointerId: 1 });
    expect(handOrder()).toEqual(['3S', '4S', '5S']);
    expect(card('4S.1').getAttribute('aria-pressed')).toBe('true');
  });

  it('releasing outside the hand still finishes the drag', () => {
    realisticRects();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    fireEvent.pointerDown(card('3S.1'), { clientX: 30, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card('3S.1'), { clientX: 400, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(document.body, { clientX: 400, clientY: 40, pointerId: 1 });
    expect(handOrder()).toEqual(['4S', '5S', '3S']);
  });

  it('a cancelled drag (e.g. touch interrupted) changes nothing', () => {
    realisticRects();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    fireEvent.pointerDown(card('3S.1'), { clientX: 30, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card('3S.1'), { clientX: 400, clientY: 40, pointerId: 1 });
    fireEvent.pointerCancel(card('3S.1'), { pointerId: 1 });
    expect(handOrder()).toEqual(['3S', '4S', '5S']);
    expect(card('3S.1').style.transform).toBe('');
  });
});

describe('undo', () => {
  function Harness({ first }: { first: Session }) {
    const [session, setSession] = useState(first);
    return (
      <Table
        session={session}
        onAction={(a) => {
          const r = apply(session, a);
          if (r.ok) setSession(r.session);
          return r.ok ? null : r.error;
        }}
        onNewGame={() => {}}
        onUndo={() => setSession(undo(session))}
      />
    );
  }
  const start = (): Session => ({
    state: scenario({ phase: 'play', hands: ['7S 7H 7D 8S 8H 8D 4C 9C', '5H 6H'] }),
    seats, log: [], undoStack: [],
  });
  const handIds = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card'));
  const layBase = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Suggest base' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lay down base' }));
  };

  it('is disabled until you have made a play', () => {
    render(<Harness first={start()} />);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes back laying down your base', () => {
    render(<Harness first={start()} />);
    layBase();
    expect(handIds()).toHaveLength(2);
    expect(document.querySelectorAll('.meld')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(handIds()).toHaveLength(8);
    expect(document.querySelectorAll('.meld')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Lay down base' })).toBeTruthy(); // base is not laid any more
  });

  it('undoes one play at a time, most recent first', () => {
    const s = start();
    s.state = scenario({ phase: 'play', hands: ['7S 7H 7D 8S 8H 8D 4S 4H 4D 7C 9C', '5H 6H'] });
    render(<Harness first={s} />);
    layBase(); // 5 cards left: 4S 4H 4D 7C 9C
    clickCards('4S.1', '4H.1', '4D.1');
    fireEvent.click(screen.getByRole('button', { name: 'Lay down selected' }));
    expect(document.querySelectorAll('.meld')).toHaveLength(3);
    clickCards('7C.1');
    fireEvent.click(screen.getAllByRole('button', { name: '+ add' })[0] as HTMLElement);
    expect(handIds()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); // takes back the add
    expect(handIds()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); // takes back the extra meld
    expect(handIds()).toHaveLength(5);
    expect(document.querySelectorAll('.meld')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' })); // takes back the base
    expect(handIds()).toHaveLength(11);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('works with Ctrl+Z and Cmd+Z', () => {
    render(<Harness first={start()} />);
    layBase();
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(handIds()).toHaveLength(8);
    layBase();
    fireEvent.keyDown(document, { key: 'Z', metaKey: true });
    expect(handIds()).toHaveLength(8);
  });

  it('is in the right-click menu', () => {
    render(<Harness first={start()} />);
    fireEvent.contextMenu(document.querySelector('.hand') as Element, { clientX: 50, clientY: 50 });
    expect((screen.getByRole('menuitem', { name: 'Undo last play' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    layBase();
    fireEvent.contextMenu(document.querySelector('.hand') as Element, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Undo last play' }));
    expect(handIds()).toHaveLength(8);
  });

  it('forgets earlier plays once you discard (your turn is over)', () => {
    render(<Harness first={start()} />);
    layBase();
    clickCards(handIds()[0] as string);
    fireEvent.click(screen.getByRole('button', { name: 'Discard selected' }));
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true); // not your turn any more
  });
});

describe('sort directions in the menu', () => {
  const handOrder = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const open = () => fireEvent.contextMenu(document.querySelector('.hand') as Element, { clientX: 100, clientY: 100 });

  it('each sort opens a second level with Ascending and Descending', () => {
    tableFor({ hands: ['5D 9S 9H', '5H'] });
    open();
    expect(screen.queryByRole('menu', { name: 'Sort by rank' })).toBeNull(); // closed until chosen
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort by rank' }));
    const sub = screen.getByRole('menu', { name: 'Sort by rank' });
    expect(within(sub).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Ascending', 'Descending']);
    expect(screen.getByRole('menu', { name: 'Arrange your hand' })).toBeTruthy(); // the first level stays open
  });

  it('sorts both ways', () => {
    tableFor({ hands: ['5D 9S 9H KC', '5H'] });
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort by rank' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Descending' }));
    expect(handOrder()).toEqual(['KC', '9H', '9S', '5D']);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort by rank' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ascending' }));
    expect(handOrder()).toEqual(['5D', '9S', '9H', 'KC']);
  });

  it('opens with the keyboard: Right arrow in, Left arrow back out', () => {
    tableFor({ hands: ['5D 9S 9H', '5H'] });
    open();
    const parent = screen.getByRole('menuitem', { name: 'Sort by sets' });
    parent.focus();
    fireEvent.keyDown(parent, { key: 'ArrowRight' });
    expect(screen.getByRole('menu', { name: 'Sort by sets' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Sort by sets' })).toBeNull();
  });

  it('Escape closes the second level first, then the menu', () => {
    tableFor({ hands: ['5D 9S 9H', '5H'] });
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort by sets' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Sort by sets' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Arrange your hand' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('pressing a sort link again flips the direction', () => {
    tableFor({ hands: ['5D 9S 9H KC', '5H'] });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by rank' }));
    expect(handOrder()).toEqual(['5D', '9S', '9H', 'KC']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by rank ↑' }));
    expect(handOrder()).toEqual(['KC', '9H', '9S', '5D']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by rank ↓' }));
    expect(handOrder()).toEqual(['5D', '9S', '9H', 'KC']);
  });
});

describe('laying a base made with wild cards', () => {
  it('Suggest base finds two sets that share three wilds (the reported bug)', () => {
    const actions = tableFor({ hands: ['7S 9S 9H X 2C 2D 4D KC', '5H'] });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest base' }));
    expect(screen.queryByText(/No base to suggest/)).toBeNull();
    expect(document.querySelectorAll('.hand .card[aria-pressed="true"]')).toHaveLength(6); // the six base cards are raised
    expect(document.querySelectorAll('.hand .card')).toHaveLength(8); // nothing disappeared
    fireEvent.click(screen.getByRole('button', { name: 'Lay down base' }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'layBase' });
  });

  it('you can just select the six base cards and press Lay down base', () => {
    const actions = tableFor({ hands: ['7S 9S 9H X 2C 2D 4D KC', '5H'] });
    const lay = screen.getByRole('button', { name: 'Lay down base' }) as HTMLButtonElement;
    expect(lay.disabled).toBe(true);
    clickCards('7S.1', '9S.1', '9H.1', 'X.1', '2C.1');
    expect(lay.disabled).toBe(true); // five cards are not enough
    clickCards('2D.1');
    expect(lay.disabled).toBe(false);
    fireEvent.click(lay);
    expect(actions).toHaveLength(1);
    const melds = (actions[0] as Extract<Action, { type: 'layBase' }>).melds;
    expect(melds).toHaveLength(2);
    expect(new Set(melds.flatMap((m) => m.cardIds)).size).toBe(6);
  });

  it('selecting extra cards that are not part of the base keeps the button off', () => {
    tableFor({ hands: ['7S 9S 9H X 2C 2D 4D KC', '5H'] });
    clickCards('7S.1', '9S.1', '9H.1', 'X.1', '2C.1', '2D.1', 'KC.1');
    expect((screen.getByRole('button', { name: 'Lay down base' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an all-wild set can be staged as a meld, and only sets are offered on a sets-only step', () => {
    const actions = tableFor({ hands: ['5S 5H 5D X 2C 2D KC', '5H'] });
    clickCards('X.1', '2C.1', '2D.1');
    fireEvent.click(screen.getByRole('button', { name: 'Add as meld' }));
    const dialog = screen.getByRole('dialog');
    const labels = within(dialog).getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels.some((l) => /^Run/.test(l))).toBe(false); // Step 1 needs sets, so no runs are offered
    fireEvent.click(within(dialog).getByRole('button', { name: /Set of 3: 5s/ }));
    clickCards('5S.1', '5H.1', '5D.1');
    fireEvent.click(screen.getByRole('button', { name: 'Add as meld' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lay down base' }));
    expect(actions[0]).toMatchObject({ type: 'layBase' });
  });
});

describe('adding selected cards to melds on the table', () => {
  const sixes = () => [set(1, 1, 6, '6C 6D 6H.2')];
  const addButton = () => screen.getByRole('button', { name: '+ add' }) as HTMLButtonElement;

  it('adds two 6s to an opponent’s set of 6s once your base is down', () => {
    const actions = tableFor({ hands: ['6S 6H 3C 9C', '5H'], baseLaid: [true], melds: sixes() });
    clickCards('6S.1', '6H.1');
    expect(addButton().disabled).toBe(false);
    expect(document.querySelector('.meld')?.classList.contains('fits')).toBe(true);
    fireEvent.click(addButton());
    expect(actions[0]).toEqual({ type: 'build', meldId: 1, cardIds: ['6S.1', '6H.1'] });
  });

  it('shows the button even before your base is down, disabled, and says why', () => {
    tableFor({ hands: ['6S 6H 3C 9C', '5H'], baseLaid: [false], melds: sixes() });
    clickCards('6S.1', '6H.1');
    expect(addButton().disabled).toBe(true);
    expect(addButton().title).toBe('Lay down your own base first');
    expect(screen.getByText(/Lay down your own base first before adding cards to melds/)).toBeTruthy();
    expect(document.querySelector('.meld')?.classList.contains('fits')).toBe(false);
  });

  it('says to draw first when you have not drawn yet', () => {
    tableFor({ hands: ['6S 6H 3C 9C', '5H'], baseLaid: [true], melds: sixes(), phase: 'draw' });
    clickCards('6S.1', '6H.1');
    expect(addButton().disabled).toBe(true);
    expect(addButton().title).toBe('Draw a card first');
    expect(screen.getByText(/Draw a card first before adding cards/)).toBeTruthy();
  });

  it('disables a meld the selected cards do not fit, and highlights the ones they do', () => {
    tableFor({
      hands: ['6S 6H 3C 9C', '5H'], baseLaid: [true],
      melds: [set(1, 1, 6, '6C 6D 6H.2'), set(2, 1, 9, '9S 9H 9D')],
    });
    clickCards('6S.1', '6H.1');
    const [forSixes, forNines] = screen.getAllByRole('button', { name: '+ add' }) as HTMLButtonElement[];
    expect(forSixes?.disabled).toBe(false);
    expect(forNines?.disabled).toBe(true);
    expect(forNines?.title).toBe("These cards don't fit this meld");
    const melds = Array.from(document.querySelectorAll('.meld'));
    expect(melds.map((m) => m.classList.contains('fits'))).toEqual([true, false]);
  });

  it('wilds fit any meld', () => {
    tableFor({ hands: ['X 3C 9C', '5H'], baseLaid: [true], melds: [set(1, 1, 6, '6C 6D 6H.2'), run(2, 1, 'H', 5, '5H 6H 7H')] });
    clickCards('X.1');
    expect((screen.getByRole('button', { name: '+ add' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '◀ add low' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'add high ▶' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('on a run, only the end the cards fit is enabled', () => {
    tableFor({ hands: ['8H 3C 9C', '5H'], baseLaid: [true], melds: [run(2, 1, 'H', 5, '5H 6H 7H')] });
    clickCards('8H.1');
    expect((screen.getByRole('button', { name: 'add high ▶' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: '◀ add low' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows nothing when no cards are selected or it is not your turn', () => {
    tableFor({ hands: ['6S 6H', '5H'], baseLaid: [true], melds: sixes() });
    expect(screen.queryByRole('button', { name: '+ add' })).toBeNull();
    cleanup();
    tableFor({ hands: ['6S 6H', '5H'], baseLaid: [true], melds: sixes(), current: 1 });
    expect(screen.queryByRole('button', { name: '+ add' })).toBeNull();
  });
});

describe('making the add option easy to find', () => {
  const sixes = () => [set(1, 1, 6, '6C 6D 6H.2')];

  it('tells you which melds your selection fits', () => {
    tableFor({ hands: ['6S 6H 3C 9C', '5H'], baseLaid: [true], melds: sixes() });
    expect(screen.queryByRole('status')).toBeNull();
    clickCards('6S.1', '6H.1');
    expect(screen.getByRole('status').textContent).toMatch(/fit the gold meld on the table/);
  });

  it('counts several gold melds', () => {
    tableFor({ hands: ['X 9C', '5H'], baseLaid: [true], melds: [set(1, 1, 6, '6C 6D 6H.2'), set(2, 1, 9, '9S 9H 9D')] });
    clickCards('X.1');
    expect(screen.getByRole('status').textContent).toMatch(/fit 2 gold melds/);
  });

  it('shows no tip when nothing fits or you cannot play yet', () => {
    tableFor({ hands: ['3C 9C', '5H'], baseLaid: [true], melds: sixes() });
    clickCards('3C.1');
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    tableFor({ hands: ['6S 6H 9C', '5H'], baseLaid: [false], melds: sixes() });
    clickCards('6S.1', '6H.1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clicking the gold meld itself adds the selected cards', () => {
    const actions = tableFor({ hands: ['6S 6H 3C 9C', '5H'], baseLaid: [true], melds: sixes() });
    clickCards('6S.1', '6H.1');
    fireEvent.click(document.querySelector('.meld') as HTMLElement);
    expect(actions).toEqual([{ type: 'build', meldId: 1, cardIds: ['6S.1', '6H.1'] }]);
  });

  it('clicking a meld that the cards do not fit does nothing', () => {
    const actions = tableFor({ hands: ['3C 9C', '5H'], baseLaid: [true], melds: sixes() });
    clickCards('3C.1');
    fireEvent.click(document.querySelector('.meld') as HTMLElement);
    expect(actions).toEqual([]);
  });

  it('clicking a run adds at the one end that fits, but not when both ends fit', () => {
    const actions = tableFor({ hands: ['8H 3C 9C', '5H'], baseLaid: [true], melds: [run(2, 1, 'H', 5, '5H 6H 7H')] });
    clickCards('8H.1');
    fireEvent.click(document.querySelector('.meld') as HTMLElement);
    expect(actions).toEqual([{ type: 'build', meldId: 2, cardIds: ['8H.1'], side: 'high' }]);
    cleanup();
    const more = tableFor({ hands: ['X 3C 9C', '5H'], baseLaid: [true], melds: [run(2, 1, 'H', 5, '5H 6H 7H')] });
    clickCards('X.1'); // a wild fits either end, so you must choose
    fireEvent.click(document.querySelector('.meld') as HTMLElement);
    expect(more).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'add high ▶' }));
    expect(more).toHaveLength(1);
  });

  it('pressing the add button does not add twice', () => {
    const actions = tableFor({ hands: ['6S 6H 3C 9C', '5H'], baseLaid: [true], melds: sixes() });
    clickCards('6S.1', '6H.1');
    fireEvent.click(screen.getByRole('button', { name: '+ add' }));
    expect(actions).toHaveLength(1);
  });
});

describe('selecting several cards and moving them together', () => {
  const SLOT = 70;
  const handOrder = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const isSelected = (id: string) => card(id).getAttribute('aria-pressed') === 'true';
  const selectedNow = () => Array.from(document.querySelectorAll('.hand [aria-pressed="true"]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);

  /** Cards sit in a row, 70px apart and 80px tall; the hand itself spans the row. Rects include transforms like a real browser. */
  const layOut = () =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.classList.contains('hand')) return { left: 0, top: 0, width: 1000, height: 80, right: 1000, bottom: 80, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const i = Array.from(document.querySelectorAll('.hand [data-card]')).indexOf(el);
      const m = /translate\((-?[\d.]+)px, (?:calc\()?(-?[\d.]+)px/.exec(el.style.transform ?? '');
      const dx = m ? Number(m[1]) : 0;
      const dy = m ? Number(m[2]) : 0;
      return { left: i * SLOT + dx, top: dy, width: 60, height: 80, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  const hand = () => document.querySelector('.hand') as HTMLElement;
  const send = (target: Element | Window, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, shift = false) =>
    fireEvent[type](target, { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: shift });

  it('Shift+drag draws a selection box that selects every card it touches', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    // From empty space just above the 2nd card, across to the middle of the 4th: touches cards 2, 3 and 4.
    send(hand(), 'pointerDown', 80, -10, true);
    send(hand(), 'pointerMove', 150, 20, true);
    send(hand(), 'pointerMove', 230, 40, true);
    expect(selectedNow()).toEqual(['4S', '5S', '6S']);
    expect(document.querySelector('.marquee')).toBeTruthy();
    send(hand(), 'pointerUp', 230, 40, true);
    expect(document.querySelector('.marquee')).toBeNull(); // the box goes away, the selection stays
    expect(selectedNow()).toEqual(['4S', '5S', '6S']);
  });

  it('the box can start on a card, and adds to what was already selected', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    clickCards('8S.1');
    send(card('3S.1'), 'pointerDown', 20, 40, true);
    send(card('3S.1'), 'pointerMove', 90, 40, true);
    send(card('3S.1'), 'pointerUp', 90, 40, true);
    expect(selectedNow()).toEqual(['3S', '4S', '8S']);
  });

  it('dragging the box over fewer cards shrinks the selection back', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    send(hand(), 'pointerDown', 5, -10, true);
    send(hand(), 'pointerMove', 300, 40, true);
    expect(selectedNow()).toEqual(['3S', '4S', '5S', '6S', '7S']);
    send(hand(), 'pointerMove', 150, 40, true); // now only reaches the 3rd card (which starts at 140)
    expect(selectedNow()).toEqual(['3S', '4S', '5S']);
    send(hand(), 'pointerUp', 150, 40, true);
  });

  it('Shift+click adds or removes a single card', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    send(card('4S.1'), 'pointerDown', 100, 40, true);
    send(card('4S.1'), 'pointerUp', 100, 40, true);
    expect(selectedNow()).toEqual(['4S']);
    send(card('5S.1'), 'pointerDown', 170, 40, true);
    send(card('5S.1'), 'pointerUp', 170, 40, true);
    expect(selectedNow()).toEqual(['4S', '5S']);
    send(card('4S.1'), 'pointerDown', 100, 40, true);
    send(card('4S.1'), 'pointerUp', 100, 40, true);
    expect(selectedNow()).toEqual(['5S']);
  });

  it('dragging a selected card carries the whole selection to the new spot', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    clickCards('3S.1', '5S.1');
    send(card('3S.1'), 'pointerDown', 30, 40);
    send(card('3S.1'), 'pointerMove', 200, 40);
    send(card('3S.1'), 'pointerMove', 395, 40); // right half of the 6th card: the very end
    send(card('3S.1'), 'pointerUp', 395, 40);
    expect(handOrder()).toEqual(['4S', '6S', '7S', '8S', '3S', '5S']);
    expect(selectedNow().sort()).toEqual(['3S', '5S']); // still selected afterwards
  });

  it('the carried cards gather near the pointer while the rest slide aside', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    clickCards('3S.1', '8S.1');
    send(card('3S.1'), 'pointerDown', 30, 40);
    send(card('3S.1'), 'pointerMove', 100, 40);
    send(card('3S.1'), 'pointerMove', 150, 40); // heading for slot 2, between 4S and 5S
    const x = (id: string) => /translate\((-?[\d.]+)px/.exec(card(id).style.transform)?.[1];
    // The anchor (3S) moved 120px with the pointer. 8S, which sits at 350px, flies over to rest 18px
    // (30% of a card) to its right: 0 + 120 + 18 - 350 = -212.
    expect(Number(x('3S.1'))).toBeCloseTo(120);
    expect(Number(x('8S.1'))).toBeCloseTo(-212);
    send(card('3S.1'), 'pointerUp', 150, 40);
    expect(handOrder()).toEqual(['4S', '3S', '8S', '5S', '6S', '7S']);
  });

  it('dragging an unselected card moves only that card', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S', '5H'] });
    clickCards('3S.1', '4S.1');
    send(card('6S.1'), 'pointerDown', 230, 40);
    send(card('6S.1'), 'pointerMove', 100, 40);
    send(card('6S.1'), 'pointerMove', 5, 40);
    send(card('6S.1'), 'pointerUp', 5, 40);
    expect(handOrder()).toEqual(['6S', '3S', '4S', '5S']);
  });

  it('pressing a selected card without dragging still just deselects it', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    clickCards('3S.1', '4S.1');
    send(card('3S.1'), 'pointerDown', 30, 40);
    send(card('3S.1'), 'pointerUp', 30, 40);
    expect(selectedNow()).toEqual(['4S']);
    expect(handOrder()).toEqual(['3S', '4S', '5S']);
  });

  it('Shift+arrow moves the whole selection one place', () => {
    tableFor({ hands: ['3S 4S 5S 6S 7S', '5H'] });
    clickCards('4S.1', '5S.1');
    fireEvent.keyDown(card('4S.1'), { key: 'ArrowRight', shiftKey: true });
    expect(handOrder()).toEqual(['3S', '6S', '4S', '5S', '7S']);
    fireEvent.keyDown(card('4S.1'), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(card('4S.1'), { key: 'ArrowLeft', shiftKey: true });
    expect(handOrder()).toEqual(['4S', '5S', '3S', '6S', '7S']);
    fireEvent.keyDown(card('4S.1'), { key: 'ArrowLeft', shiftKey: true }); // already at the front
    expect(handOrder()).toEqual(['4S', '5S', '3S', '6S', '7S']);
  });

  it('a selection made by a box can be played as a meld straight away', () => {
    const actions = tableFor({ hands: ['5H 6H 7H 9C KD', '5H'], baseLaid: [true] });
    layOut();
    send(hand(), 'pointerDown', 5, -10, true);
    send(hand(), 'pointerMove', 190, 40, true);
    send(hand(), 'pointerUp', 190, 40, true);
    expect(selectedNow().length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: 'Lay down selected' }));
    expect(actions[0]).toMatchObject({ type: 'layMeld', meld: { kind: 'run', suit: 'H' } });
  });
});

describe('the 15 steps pop-up', () => {
  const openFromMenu = () => {
    fireEvent.contextMenu(document.querySelector('.hand') as Element, { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show the 15 steps' }));
  };

  it('has an Options button, left of the 15 steps button, that opens an options card', () => {
    tableFor({ hands: ['3S 4S', '5H'] });
    const buttons = Array.from(document.querySelectorAll('.topbar-buttons button')).map((b) => b.textContent);
    expect(buttons.slice(0, 2)).toEqual(['Options', '15 steps']);
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.getByRole('dialog', { name: 'Options' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Options' })).toBeNull();
  });

  it('the activity window can be turned off and on in Options, and the choice is remembered', () => {
    tableFor({ hands: ['3S 4S', '5H'] });
    expect(document.querySelector('.log')).toBeNull(); // off unless the player turns it on
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /activity window/i }));
    expect(document.querySelector('.log')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('15steps.options.v1') ?? '{}')).toEqual({ showActivity: true, animations: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /activity window/i }));
    expect(document.querySelector('.log')).toBeNull();
  });

  it('opens from the right-click menu and lists every step', () => {
    tableFor({ hands: ['3S 4S', '5H'], steps: [4, 7] });
    expect(screen.queryByRole('dialog', { name: '15 steps' })).toBeNull();
    openFromMenu();
    const card = screen.getByRole('dialog', { name: '15 steps' });
    expect(screen.queryByRole('menu')).toBeNull(); // the menu closed itself
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(15);
    expect(rows[0]?.textContent).toContain('two sets of 3');
    expect(rows[3]?.textContent).toContain('five pairs');
    expect(rows[14]?.textContent).toContain('one run of 10');
  });

  it('highlights your step, dims the ones you have finished, and shows where each player is', () => {
    tableFor({ hands: ['3S 4S', '5H'], steps: [4, 7] });
    openFromMenu();
    const card = screen.getByRole('dialog', { name: '15 steps' });
    const rows = within(card).getAllByRole('listitem');
    expect(rows[3]?.getAttribute('aria-current')).toBe('step');
    expect(rows[3]?.classList.contains('current')).toBe(true);
    expect([0, 1, 2].every((i) => rows[i]?.classList.contains('done'))).toBe(true);
    expect(rows[4]?.classList.contains('done')).toBe(false);
    expect(within(rows[3] as HTMLElement).getByText('Sam')).toBeTruthy();
    expect(within(rows[6] as HTMLElement).getByText('Ada')).toBeTruthy();
  });

  it('shows two players on the same step', () => {
    tableFor({ hands: ['3S', '5H'] });
    openFromMenu();
    const first = within(screen.getByRole('dialog', { name: '15 steps' })).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(first).getByText('Sam')).toBeTruthy();
    expect(within(first).getByText('Ada')).toBeTruthy();
  });

  it('closes with the Close button, Escape, or a click outside the card', () => {
    tableFor({ hands: ['3S 4S', '5H'] });
    const isOpen = () => !!screen.queryByRole('dialog', { name: '15 steps' });
    openFromMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(isOpen()).toBe(false);
    openFromMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
    openFromMenu();
    fireEvent.click(screen.getByRole('dialog', { name: '15 steps' })); // inside the card: stays open
    expect(isOpen()).toBe(true);
    fireEvent.click(document.querySelector('.overlay') as Element); // the dark area outside it
    expect(isOpen()).toBe(false);
  });

  it('is also a link in the header', () => {
    tableFor({ hands: ['3S 4S', '5H'] });
    fireEvent.click(screen.getByRole('button', { name: '15 steps' }));
    expect(screen.getByRole('dialog', { name: '15 steps' })).toBeTruthy();
  });
});

describe('clicking empty board clears the selection', () => {
  const selectedNow = () => Array.from(document.querySelectorAll('.hand [aria-pressed="true"]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const press = (target: Element, x = 500, y = 300, upTarget: Element = target, upX = x, upY = y) => {
    fireEvent.pointerDown(target, { clientX: x, clientY: y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(upTarget, { clientX: upX, clientY: upY, pointerId: 1 });
  };
  const board = () => document.querySelector('.table') as Element;
  const centre = () => document.querySelector('.center') as Element;

  it('deselects everything when you click an empty spot', () => {
    tableFor({ hands: ['3S 4S 5S 6S', '5H'] });
    clickCards('3S.1', '5S.1');
    expect(selectedNow()).toEqual(['3S', '5S']);
    press(centre());
    expect(selectedNow()).toEqual([]);
  });

  it('works on the table background too, and when it is not your turn', () => {
    tableFor({ hands: ['3S 4S 5S', '5H'], current: 1 });
    clickCards('3S.1');
    press(board());
    expect(selectedNow()).toEqual([]);
  });

  it('clicking a card, a button or a meld does not clear it', () => {
    tableFor({ hands: ['3S 4S 5S', '5H'], baseLaid: [true], melds: [set(1, 1, 6, '6C 6D 6H.2')] });
    clickCards('3S.1');
    press(card('4S.1')); // pressing another card selects it as well
    expect(selectedNow()).toEqual(['3S', '4S']);
    press(screen.getByRole('button', { name: 'Sort by suit' }));
    expect(selectedNow()).toEqual(['3S', '4S']);
    press(document.querySelector('.meld') as Element);
    expect(selectedNow()).toEqual(['3S', '4S']);
  });

  it('empty space inside the hand row is not "empty board" (that is where the selection box starts)', () => {
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    clickCards('3S.1');
    press(document.querySelector('.hand') as Element);
    expect(selectedNow()).toEqual(['3S']);
  });

  it('a selection box that ends over empty board keeps the selection it made', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.classList.contains('hand')) return { left: 0, top: 0, width: 1000, height: 80, right: 1000, bottom: 80, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const i = Array.from(document.querySelectorAll('.hand [data-card]')).indexOf(el);
      return { left: i * 70, top: 0, width: 60, height: 80, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    tableFor({ hands: ['3S 4S 5S 6S', '5H'] });
    const hand = document.querySelector('.hand') as Element;
    fireEvent.pointerDown(hand, { clientX: 5, clientY: -10, button: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerMove(hand, { clientX: 300, clientY: 40, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(centre(), { clientX: 300, clientY: 40, pointerId: 1, shiftKey: true });
    expect(selectedNow()).toEqual(['3S', '4S', '5S', '6S']);
  });

  it('dragging a card and letting go over empty board keeps the selection', () => {
    tableFor({ hands: ['3S 4S 5S 6S', '5H'] });
    clickCards('3S.1', '4S.1');
    fireEvent.pointerDown(card('3S.1'), { clientX: 30, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerMove(card('3S.1'), { clientX: 300, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(centre(), { clientX: 300, clientY: 400, pointerId: 1 });
    expect(selectedNow().sort()).toEqual(['3S', '4S']);
  });

  it('a press that starts on a card but ends on empty board does not clear anything', () => {
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    clickCards('3S.1');
    press(card('4S.1'), 100, 40, centre(), 100, 40);
    expect(selectedNow()).toContain('3S');
  });

  it('a press that starts on empty board but is dragged away does not clear', () => {
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    clickCards('3S.1');
    press(centre(), 500, 300, centre(), 560, 360);
    expect(selectedNow()).toEqual(['3S']);
  });

  it('does nothing when no cards are selected, and ignores pop-ups', () => {
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    press(centre());
    expect(selectedNow()).toEqual([]);
    clickCards('3S.1');
    fireEvent.click(screen.getByRole('button', { name: '15 steps' }));
    const overlay = document.querySelector('.overlay') as Element;
    press(overlay); // the dark area closes the pop-up but must not touch the selection
    expect(selectedNow()).toEqual(['3S']);
  });
});

describe('dragging from empty space selects, no Shift needed', () => {
  const selectedNow = () => Array.from(document.querySelectorAll('.hand [aria-pressed="true"]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const handOrder = () => Array.from(document.querySelectorAll('.hand [data-card]')).map((el) => el.getAttribute('data-card')?.split('.')[0]);
  const layOut = () =>
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      if (el.classList.contains('hand')) return { left: 0, top: 0, width: 1000, height: 80, right: 1000, bottom: 80, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const i = Array.from(document.querySelectorAll('.hand [data-card]')).indexOf(el);
      return { left: i * 70, top: 0, width: 60, height: 80, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
  const hand = () => document.querySelector('.hand') as HTMLElement;
  const board = () => document.querySelector('.center') as HTMLElement;
  const send = (target: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, extra: object = {}) =>
    fireEvent[type](target, { clientX: x, clientY: y, button: 0, pointerId: 1, ...extra });
  const dragBox = (from: Element, x1: number, y1: number, x2: number, y2: number, extra: object = {}) => {
    send(from, 'pointerDown', x1, y1, extra);
    send(from, 'pointerMove', (x1 + x2) / 2, (y1 + y2) / 2, extra);
    send(from, 'pointerMove', x2, y2, extra);
    send(from, 'pointerUp', x2, y2, extra);
  };

  it('a plain drag from empty space in the hand row draws a box and selects what it touches', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    dragBox(hand(), 75, -10, 230, 40); // touches cards 2, 3 and 4
    expect(selectedNow()).toEqual(['4S', '5S', '6S']);
  });

  it('works starting on the empty board around the hand', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    dragBox(board(), 5, -200, 150, 40);
    expect(selectedNow()).toEqual(['3S', '4S', '5S']);
  });

  it('shows the box while dragging and removes it afterwards', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    send(board(), 'pointerDown', 5, -100);
    send(board(), 'pointerMove', 100, 40);
    expect(document.querySelector('.marquee')).toBeTruthy();
    send(board(), 'pointerUp', 100, 40);
    expect(document.querySelector('.marquee')).toBeNull();
  });

  it('a plain box replaces the old selection; Shift adds to it', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    clickCards('8S.1');
    dragBox(hand(), 5, -10, 60, 40); // plain: the 8 is dropped from the selection
    expect(selectedNow()).toEqual(['3S']);
    dragBox(hand(), 145, -10, 200, 40, { shiftKey: true }); // Shift: keeps the 3, adds the 5
    expect(selectedNow()).toEqual(['3S', '5S']);
  });

  it('a box that touches nothing clears the selection', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    clickCards('3S.1');
    dragBox(board(), 500, 200, 600, 300); // far from every card
    expect(selectedNow()).toEqual([]);
  });

  it('dragging from a card still moves the card; it does not draw a box', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S', '5H'] });
    send(card('3S.1'), 'pointerDown', 30, 40);
    send(card('3S.1'), 'pointerMove', 150, 40);
    expect(document.querySelector('.marquee')).toBeNull();
    send(card('3S.1'), 'pointerUp', 150, 40);
    expect(handOrder()).toEqual(['4S', '3S', '5S', '6S']);
    expect(selectedNow()).toEqual([]);
  });

  it('pressing buttons, melds and pop-ups never starts a box', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'], baseLaid: [true], melds: [set(1, 1, 6, '6C 6D 6H.2')] });
    clickCards('3S.1');
    const button = screen.getByRole('button', { name: 'Sort by suit' });
    send(button, 'pointerDown', 5, -10);
    send(button, 'pointerMove', 300, 40);
    expect(document.querySelector('.marquee')).toBeNull();
    send(button, 'pointerUp', 300, 40);
    send(document.querySelector('.meld') as Element, 'pointerDown', 5, -10);
    send(document.querySelector('.meld') as Element, 'pointerMove', 300, 40);
    expect(document.querySelector('.marquee')).toBeNull();
    send(document.querySelector('.meld') as Element, 'pointerUp', 300, 40);
    expect(selectedNow()).toContain('3S');
  });

  it('a finger does not draw a box (it scrolls the page instead)', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    dragBox(board(), 5, -100, 150, 40, { pointerType: 'touch' });
    expect(selectedNow()).toEqual([]);
  });

  it('a click without moving on empty board still just clears the selection', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S', '5H'] });
    clickCards('3S.1', '4S.1');
    send(board(), 'pointerDown', 500, 200);
    send(board(), 'pointerUp', 500, 200);
    expect(selectedNow()).toEqual([]);
    expect(document.querySelector('.marquee')).toBeNull();
  });

  it('the cards you boxed can be carried together straight away', () => {
    layOut();
    tableFor({ hands: ['3S 4S 5S 6S 7S 8S', '5H'] });
    dragBox(hand(), 5, -10, 130, 40); // selects 3S and 4S
    expect(selectedNow()).toEqual(['3S', '4S']);
    send(card('3S.1'), 'pointerDown', 30, 40);
    send(card('3S.1'), 'pointerMove', 200, 40);
    send(card('3S.1'), 'pointerMove', 395, 40); // the far end
    send(card('3S.1'), 'pointerUp', 395, 40);
    expect(handOrder()).toEqual(['5S', '6S', '7S', '8S', '3S', '4S']);
  });
});

describe('the new-game screen', () => {
  const start = () => {
    const calls: SetupOptions[] = [];
    render(<Setup onStart={(o) => calls.push(o)} />);
    return calls;
  };
  const opponents = () => screen.getByLabelText('Opponents') as HTMLSelectElement;
  const computer = (n: number) => screen.getByLabelText(`Computer ${n}`) as HTMLSelectElement;

  it('starts as a 2-player game against one Medium computer', () => {
    const calls = start();
    expect(opponents().value).toBe('1');
    expect(computer(1).value).toBe('medium');
    expect(screen.queryByLabelText('Computer 2')).toBeNull();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('You');
    expect((screen.getByLabelText(/Watch the computer players/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(calls[0]).toMatchObject({ name: 'You', opponents: ['medium'], spectate: false });
  });

  it('remembers what you changed, after closing and reopening', () => {
    const first = render(<Setup onStart={() => {}} />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Steve' } });
    fireEvent.change(opponents(), { target: { value: '3' } });
    fireEvent.change(computer(1), { target: { value: 'hard' } });
    fireEvent.change(computer(3), { target: { value: 'easy' } });
    first.unmount(); // closing the program
    const calls = start(); // starting it again
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Steve');
    expect(opponents().value).toBe('3');
    expect([computer(1).value, computer(2).value, computer(3).value]).toEqual(['hard', 'medium', 'easy']);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(calls[0]).toMatchObject({ name: 'Steve', opponents: ['hard', 'medium', 'easy'] });
  });

  it('remembers a change even if you never press Start', () => {
    const first = render(<Setup onStart={() => {}} />);
    fireEvent.change(computer(1), { target: { value: 'easy' } });
    first.unmount();
    render(<Setup onStart={() => {}} />);
    expect(computer(1).value).toBe('easy');
  });

  it('remembers watch-only mode and its players', () => {
    const first = render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Watch the computer players/));
    expect(screen.getByLabelText('Players')).toBeTruthy();
    expect((screen.getByLabelText('Players') as HTMLSelectElement).value).toBe('2'); // watching needs at least two
    fireEvent.change(computer(2), { target: { value: 'hard' } });
    first.unmount();
    render(<Setup onStart={() => {}} />);
    expect((screen.getByLabelText(/Watch the computer players/) as HTMLInputElement).checked).toBe(true);
    expect(computer(2).value).toBe('hard');
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('switching back from watch-only keeps the count within range', () => {
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Watch the computer players/));
    fireEvent.change(screen.getByLabelText('Players'), { target: { value: '6' } });
    fireEvent.click(screen.getByLabelText(/Watch the computer players/));
    expect(opponents().value).toBe('5'); // 6 computers is only for watching
  });

  it('ignores corrupt saved settings and uses the defaults', () => {
    localStorage.setItem(SETUP_PREFS_KEY, '{{{ nope');
    start();
    expect(opponents().value).toBe('1');
    expect(computer(1).value).toBe('medium');
  });

  it('a new game from the app uses the remembered settings', async () => {
    localStorage.setItem(SETUP_PREFS_KEY, JSON.stringify({ name: 'Steve', opponents: ['hard'], spectate: false }));
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<App aiDelayMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => screen.getByText(/draw a card/), { timeout: 3000 });
    // A 2-player game against one Hard computer, with the remembered name.
    const opponentPanels = document.querySelectorAll('.opponent');
    expect(opponentPanels).toHaveLength(1);
    expect(opponentPanels[0]?.textContent).toContain('(hard)');
    expect(document.querySelectorAll('.hand .card')).toHaveLength(13);
  });

  it('works even when the browser will not store anything', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    start();
    fireEvent.change(computer(1), { target: { value: 'hard' } });
    expect(computer(1).value).toBe('hard');
  });
});

describe('watching the computers play', () => {
  const computers = [
    { name: 'Ada', kind: 'hard' as const },
    { name: 'Ben', kind: 'medium' as const },
  ];
  const watchSession = (extra: Parameters<typeof scenario>[0] = { hands: ['3S 4S 5S 9H', '7D 7C KH'] }): Session => ({
    state: scenario({ phase: 'play', ...extra }),
    seats: computers,
    log: [],
    undoStack: [],
  });
  const noop = () => {};
  const watchProps = (over: Partial<{ paused: boolean }> = {}) => ({ paused: false, onTogglePause: noop, onStep: noop, ...over });
  const showTable = (session: Session, watch = watchProps()) =>
    render(<Table session={session} onAction={() => null} onNewGame={noop} watch={watch} />);
  const revealed = () => document.querySelectorAll('.opponent .reveal-hand .card');

  describe('seeing the cards', () => {
    it('shows the cards of the computer whose turn it is (in the middle of the carousel) face-up, the others face-down', () => {
      showTable(watchSession());
      expect(revealed()).toHaveLength(4); // Ada's, whose turn it is
      expect(document.querySelectorAll('.opponent .back-card').length).toBe(3); // Ben's
      const ada = within(screen.getByLabelText("Ada's cards"));
      expect(ada.getAllByText(/^[2-9AKQJ]|10$/).length).toBeGreaterThan(0);
      expect(Array.from(document.querySelector('.opponent.focus')?.querySelectorAll('.reveal-hand [data-card]') ?? []).map((e) => e.getAttribute('data-card')?.split('.')[0]))
        .toEqual(['3S', '4S', '5S', '9H']); // in a sensible order
    });

    it('can be switched off, and back on', () => {
      showTable(watchSession());
      fireEvent.click(screen.getByLabelText(/Show the computers’ cards/));
      expect(revealed()).toHaveLength(0);
      expect(document.querySelectorAll('.opponent .back-card').length).toBe(7); // face-down again
      fireEvent.click(screen.getByLabelText(/Show the computers’ cards/));
      expect(revealed()).toHaveLength(4);
    });

    it('never shows an opponent’s cards in a game you are playing', () => {
      tableFor({ hands: ['3S 4S', '5H 6H 7H'] });
      expect(document.querySelectorAll('.reveal-hand')).toHaveLength(0);
      expect(document.querySelectorAll('[data-card="5H.1"]')).toHaveLength(0);
      expect(screen.queryByLabelText(/Show the computers’ cards/)).toBeNull();
    });

    it('keeps the layout steady when a round ends: the penalties are in the banner, not in everyone’s revealed hand', () => {
      const state = scenario({ phase: 'play', hands: ['3S', 'X 5H'], baseLaid: [true, false] });
      const done = applyAction(state, { type: 'discard', cardId: '3S.1' });
      if (!done.ok) throw new Error(done.error);
      showTable({ ...watchSession(), state: done.state });
      expect(document.querySelector('.round-banner')?.textContent).toMatch(/Round over/);
      expect(document.querySelectorAll('.opponent .reveal-hand').length).toBeLessThanOrEqual(1);
    });
  });

  describe('the watching controls', () => {
    it('are shown only when nobody is playing', () => {
      showTable(watchSession());
      expect(screen.getByRole('region', { name: 'Watching controls' })).toBeTruthy();
      cleanup();
      tableFor({ hands: ['3S 4S', '5H 6H'] });
      expect(screen.queryByRole('region', { name: 'Watching controls' })).toBeNull();
    });

    it('Pause, Resume and Step reflect the paused state', () => {
      const calls: string[] = [];
      const props = { paused: false, onTogglePause: () => calls.push('toggle'), onStep: () => calls.push('step') };
      const { unmount } = showTable(watchSession(), props);
      const step = () => screen.getByRole('button', { name: 'Step' }) as HTMLButtonElement;
      expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy();
      expect(step().disabled).toBe(true); // stepping is for when it is paused
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      unmount();
      showTable(watchSession(), { ...props, paused: true });
      expect(screen.getByRole('button', { name: /Resume/ })).toBeTruthy();
      expect(step().disabled).toBe(false);
      expect(screen.getByText(/\(paused\)/)).toBeTruthy();
      fireEvent.click(step());
      expect(calls).toEqual(['toggle', 'step']);
    });

    it('Stop game and Stop watching both leave', () => {
      let left = 0;
      render(<Table session={watchSession()} onAction={() => null} onNewGame={() => left++} watch={watchProps()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Stop game' }));
      fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
      expect(left).toBe(2);
    });

    it('a round ending is a banner, not a pop-up that hides the cards', () => {
      const state = scenario({ phase: 'play', hands: ['3S', '9H 5H'], baseLaid: [true, false] });
      const done = applyAction(state, { type: 'discard', cardId: '3S.1' });
      if (!done.ok) throw new Error(done.error);
      showTable({ ...watchSession(), state: done.state });
      expect(screen.queryByRole('dialog', { name: 'Round over' })).toBeNull();
      expect(screen.getByRole('status').textContent).toMatch(/Ada went out\. Penalties: Ada 0, Ben 10/);
      expect(screen.getByRole('status').textContent).toMatch(/next round starts in a moment/);
      cleanup();
      showTable({ ...watchSession(), state: done.state }, watchProps({ paused: true }));
      expect(screen.getByRole('status').textContent).toMatch(/Paused: press Resume or Step/);
    });
  });

  describe('in the app', () => {
    const startWatching = async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.37);
      render(<App aiDelayMs={5} />);
      fireEvent.click(screen.getByLabelText(/Watch the computer players/));
      fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
      await screen.findByRole('region', { name: 'Watching controls' });
    };
    beforeEach(showLog);
    const logText = () => document.querySelector('.log')?.textContent ?? '';
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('pausing really stops the game, and Resume carries on', async () => {
      await startWatching();
      await waitFor(() => expect(logText()).toMatch(/took|discarded/), { timeout: 3000 });
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      await sleep(30); // let any move already scheduled finish
      const frozen = logText();
      await sleep(150);
      expect(logText()).toBe(frozen); // nothing moved while paused
      fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
      await waitFor(() => expect(logText()).not.toBe(frozen), { timeout: 3000 });
    });

    it('Step plays one move while paused, then waits again', async () => {
      await startWatching();
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      await sleep(30);
      const before = logText();
      fireEvent.click(screen.getByRole('button', { name: 'Step' }));
      await waitFor(() => expect(logText()).not.toBe(before)); // the step did something
      const afterStep = logText();
      await sleep(150);
      expect(logText()).toBe(afterStep); // and then it waited again
      fireEvent.click(screen.getByRole('button', { name: 'Step' }));
      await waitFor(() => expect(logText()).not.toBe(afterStep)); // each press plays another move
    });

    it('Stop game goes back to the setup screen', async () => {
      await startWatching();
      fireEvent.click(screen.getByRole('button', { name: 'Stop game' }));
      expect(screen.getByRole('button', { name: 'Start game' })).toBeTruthy();
      expect(screen.queryByRole('region', { name: 'Watching controls' })).toBeNull();
    });

    it('a game started after stopping is not left paused', async () => {
      await startWatching();
      fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Stop game' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
      await screen.findByRole('region', { name: 'Watching controls' });
      expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy(); // running, not paused
    });

    it('the arrows beside Pause change the speed: slower and faster, with the speed shown between', async () => {
      localStorage.removeItem('15steps.speed.v1');
      await startWatching();
      const label = () => document.querySelector('.speed-label')?.textContent;
      expect(label()).toBe('1×');
      fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
      expect(label()).toBe('1.5×');
      for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
      expect((screen.getByRole('button', { name: 'Faster' }) as HTMLButtonElement).disabled).toBe(true); // at the fastest
      for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Slower' }));
      expect(label()).toBe('0.5×');
      expect((screen.getByRole('button', { name: 'Slower' }) as HTMLButtonElement).disabled).toBe(true); // at the slowest
      localStorage.removeItem('15steps.speed.v1');
    });

    it('shows the computers’ cards in the running app', async () => {
      await startWatching();
      expect(document.querySelectorAll('.opponent .reveal-hand').length).toBe(1); // the computer whose turn it is
      expect(document.querySelectorAll('.opponent .reveal-hand .card').length).toBeGreaterThan(10);
    });
  });
});

const showLog = () => localStorage.setItem('15steps.options.v1', JSON.stringify({ showActivity: true, animations: true }));

describe('the activity card', () => {
  beforeEach(showLog);
  const lines = () => Array.from(document.querySelectorAll('.log-lines div')).map((e) => e.textContent);
  const withLog = (log: string[]) => {
    const session: Session = { state: scenario({ phase: 'play', hands: ['3S 4S', '5H'] }), seats, log, undoStack: [] };
    render(<Table session={session} onAction={() => null} onNewGame={() => {}} />);
  };
  const five = ['Ada took a card.', 'Ada discarded K♣.', 'Ben took the discard.', 'Ben laid down their base.', 'Ben discarded 9♦.'];

  it('is a small labelled card showing the latest few actions, newest last', () => {
    withLog(five);
    expect(screen.getByRole('region', { name: 'Activity' })).toBeTruthy();
    expect(lines()).toEqual(five.slice(-4));
    expect(document.querySelector('.log-lines .latest')?.textContent).toBe('Ben discarded 9♦.');
  });

  it('can be folded away to just the latest action, and opened again', () => {
    withLog(five);
    fireEvent.click(screen.getByRole('button', { name: 'Hide activity' }));
    expect(lines()).toEqual(['Ben discarded 9♦.']);
    expect(document.querySelector('.log')?.classList.contains('collapsed')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show activity' }));
    expect(lines()).toHaveLength(4);
  });

  it('announces new actions politely to screen readers', () => {
    withLog(five);
    expect(screen.getByRole('region', { name: 'Activity' }).getAttribute('aria-live')).toBe('polite');
  });

  it('is not part of the empty board: clicking it does not clear your selection', () => {
    withLog(five);
    clickCards('3S.1');
    fireEvent.pointerDown(document.querySelector('.log') as Element, { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    fireEvent.pointerUp(document.querySelector('.log') as Element, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(card('3S.1').getAttribute('aria-pressed')).toBe('true');
  });

  it('copes with an empty log', () => {
    withLog([]);
    expect(lines()).toEqual([]);
  });
});

describe('the polished look', () => {
  const threeSeats = [
    { name: 'Sam', kind: 'human' as const },
    { name: 'Ada', kind: 'medium' as const },
    { name: 'Ben', kind: 'hard' as const },
  ];
  const show = (sc: Parameters<typeof scenario>[0]) => {
    const session: Session = { state: scenario({ phase: 'play', ...sc }), seats: threeSeats, log: [], undoStack: [] };
    render(<Table session={session} onAction={() => null} onNewGame={() => {}} />);
  };

  describe('cards', () => {
    it('each card is named for a screen reader', () => {
      show({ hands: ['QH 7S X 2D', '5H 6H', '3C'] });
      expect(card('QH.1').getAttribute('aria-label')).toBe('queen of hearts');
      expect(card('7S.1').getAttribute('aria-label')).toBe('7 of spades');
      expect(card('X.1').getAttribute('aria-label')).toBe('joker');
      expect(card('2D.1').getAttribute('aria-label')).toBe('2 of diamonds (wild)');
    });

    it('a face shows its rank and suit in the corner and a big suit in the middle', () => {
      show({ hands: ['QH 7S', '5H', '3C'] });
      const q = card('QH.1');
      expect(q.querySelector('.index.tl .rank')?.textContent).toBe('Q');
      expect(q.querySelector('.index.tl .pip')?.textContent).toBe('♥');
      expect(q.querySelector('.center-pip')?.textContent).toBe('♥');
      expect(q.classList.contains('red')).toBe(true);
      expect(card('7S.1').classList.contains('black')).toBe(true);
      expect(q.querySelector('.index.br')).toBeNull(); // no upside-down index: a rotated 9 reads as a 6
    });

    it('wild cards are marked: 2s and jokers say WILD, other cards do not', () => {
      show({ hands: ['2D X QH', '5H', '3C'] });
      expect(card('2D.1').querySelector('.wild-tag')?.textContent).toBe('WILD');
      expect(card('2D.1').classList.contains('wild')).toBe(true);
      expect(card('X.1').querySelector('.wild-tag')?.textContent).toBe('WILD');
      expect(card('X.1').querySelector('.joker-star')).toBeTruthy();
      expect(card('QH.1').querySelector('.wild-tag')).toBeNull();
    });

    it('the draw pile is a card back with the 15 emblem and a badge counting what is left', () => {
      show({ hands: ['3S', '5H', '3C'], stock: '5S.2 6S.2 7S.2 8S.2' });
      const back = document.querySelector('.piles .card.back') as HTMLElement;
      expect(back.querySelector('.emblem')?.textContent).toBe('15steps');
      expect(back.querySelector('.badge')?.textContent).toBe('4');
    });

    it('the discard pile card tells you it can be taken', () => {
      show({ hands: ['3S', '5H', '3C'], phase: 'draw', discard: 'KD' });
      expect(document.querySelector('.piles [data-card="KD.1"]')?.getAttribute('aria-label')).toBe('king of diamonds — Take the discard');
    });
  });

  describe('the table', () => {
    it('sits inside a wooden frame', () => {
      show({ hands: ['3S', '5H', '3C'] });
      expect(document.querySelector('.frame > .table')).toBeTruthy();
    });

    it('has a scoreboard listing every player with their score, and marks whose turn it is', () => {
      show({ hands: ['3S', '5H', '3C'], scores: [0, 25, 10], current: 2 });
      const board = screen.getByLabelText('Scores');
      const rows = Array.from(board.querySelectorAll('li')).map((li) => li.textContent);
      expect(rows).toEqual(['SamStep 10', 'AdaStep 125', 'BenStep 110']);
      expect(board.querySelector('li.turn')?.textContent).toBe('BenStep 110');
      expect(board.textContent).toMatch(/Round 1/);
      expect(board.textContent).toMatch(/Lowest score wins/i);
    });

    it('shows "Your turn — draw a card" once, inside your own window, and only while you are drawing', () => {
      show({ hands: ['3S', '5H', '3C'], current: 0, phase: 'draw' });
      const pills = document.querySelectorAll('.status-pill');
      expect(pills).toHaveLength(1);
      expect(pills[0]?.textContent).toBe('Your turn — draw a card');
      expect(document.querySelector('.mine')?.contains(pills[0] as Node)).toBe(true);
    });

    it('shows no turn pill while a computer is playing (the glowing window and the activity card say who)', () => {
      show({ hands: ['3S', '5H', '3C'], current: 2 });
      expect(document.querySelectorAll('.status-pill')).toHaveLength(0);
    });

    it('each computer has a name pill and a card back per card in their hand', () => {
      show({ hands: ['3S', '5H 6H 7H', '3C 4C'] });
      const panels = Array.from(document.querySelectorAll('.opponent'));
      expect(panels.map((p) => p.querySelector('.name')?.textContent?.replace(/\s+/g, ' ').trim().split(' (')[0])).toEqual(['Ada', 'Ben']);
      expect(document.querySelector('.card-count')).toBeNull(); // the count is in the details line, not a separate badge
      expect(panels.map((p) => p.querySelectorAll('.back-card').length)).toEqual([3, 2]);
    });

    it('only the player whose turn it is is marked as active', () => {
      show({ hands: ['3S', '5H', '3C'], current: 2 });
      const [ada, ben] = Array.from(document.querySelectorAll('.opponent'));
      expect(ada?.classList.contains('active')).toBe(false);
      expect(ben?.classList.contains('active')).toBe(true);
      expect(ben?.getAttribute('aria-current')).toBe('true');
      expect(ben?.textContent).toMatch(/Playing/);
    });

    it('your own panel glows on your turn, and has a name tab', () => {
      show({ hands: ['3S', '5H', '3C'], current: 0, phase: 'draw' });
      const mine = document.querySelector('.mine') as HTMLElement;
      expect(mine.classList.contains('active')).toBe(true);
      expect(mine.querySelector('.tab')?.textContent).toContain('Sam');
      cleanup();
      show({ hands: ['3S', '5H', '3C'], current: 1 });
      expect((document.querySelector('.mine') as HTMLElement).classList.contains('active')).toBe(false);
    });

    it('melds on the table are labelled with who laid them', () => {
      show({ hands: ['3S', '5H', '3C'], melds: [set(1, 1, 6, '6C 6D 6H.2')] });
      expect(document.querySelector('.owner-melds .owner')?.textContent).toBe('Ada');
    });

    it('an empty table shows a dashed slot saying where melds will appear', () => {
      show({ hands: ['3S', '5H', '3C'] });
      expect(document.querySelector('.slot-hint')?.textContent).toMatch(/Melds laid down by anyone will appear here/);
    });
  });
});

describe('opponents show their step in full, and the table is arranged to fit', () => {
  const seats3 = [
    { name: 'Sam', kind: 'human' as const },
    { name: 'Ada', kind: 'medium' as const },
    { name: 'Ben', kind: 'hard' as const },
  ];
  const show = (sc: Parameters<typeof scenario>[0], seatList = seats3) => {
    const session: Session = { state: scenario({ phase: 'play', ...sc }), seats: seatList, log: ['Ada took a card.'], undoStack: [] };
    render(<Table session={session} onAction={() => null} onNewGame={() => {}} />);
  };
  const panel = (i: number) => document.querySelectorAll('.opponent')[i] as HTMLElement;

  it('each opponent’s panel says which step they are on and what it needs, like yours does', () => {
    show({ hands: ['3S', '5H', '3C'], steps: [1, 3, 9] });
    // all in the pill in the bar across the top of the window
    expect(panel(0).querySelector('.opp-bar .step-pill')?.textContent?.trim()).toBe('Step 3: one run of 7');
    expect(panel(1).querySelector('.opp-bar .step-pill')?.textContent?.trim()).toBe('Step 9: two runs of 3 + one set of 3');
    expect(document.querySelector('.mine .mine-step')?.textContent).toContain('Step 1:'); // yours, for comparison
  });

  it('covers every step, matching the wording used on your own panel', () => {
    for (let step = 1; step <= 15; step++) {
      cleanup();
      show({ hands: ['3S', '5H', '3C'], steps: [1, step, 1] });
      const mine = describeStepText(step);
      expect(panel(0).querySelector('.opp-bar .step-pill')?.textContent).toContain(mine);
    }
  });

  it('shows a tick when they have laid down their base, and not before', () => {
    show({ hands: ['3S', '5H', '3C'], baseLaid: [false, true, false] });
    expect(panel(0).querySelector('.opp-bar .base-down')?.textContent?.trim()).toBe('✓ base down');
    expect(panel(1).querySelector('.base-down')).toBeNull();
  });

  it('shows their score and how many cards they hold', () => {
    show({ hands: ['3S', '5H 6H 7H', '3C'], scores: [0, 25, 0] });
    expect(panel(0).querySelector('.opp-meta')?.textContent).toBe('25 pts · 3 cards');
  });

  it('also shows the step details when you are only watching', () => {
    const watchSeats = [{ name: 'Ada', kind: 'hard' as const }, { name: 'Ben', kind: 'medium' as const }];
    show({ hands: ['3S 4S', '5H'], steps: [7, 12] }, watchSeats);
    const seat = (i: number) => document.querySelector(`.opponent[data-seat="${i}"] .opp-bar .step-pill`)?.textContent?.trim();
    expect(seat(0)).toBe('Step 7: one set of 4 + one run of 3');
    expect(seat(1)).toBe('Step 12: one set of 3 + one run of 7');
  });

  it('six computers playing use the very same carousel layout as a game with you in it (no stacked column of hands)', () => {
    const six = ['Ada', 'Ben', 'Cleo', 'Dax', 'Eve', 'Finn'].map((name) => ({ name, kind: 'hard' as const }));
    show({ hands: ['3S 4S', '5H', '3C', '4C', '6C', '7C'], current: 3 }, six);
    const opp = document.querySelector('.opponents') as HTMLElement;
    expect(opp.hasAttribute('data-carousel')).toBe(true);
    expect(opp.getAttribute('data-count')).toBe('5');
    expect(document.querySelectorAll('.opponent')).toHaveLength(6);
    expect(opp.querySelector('.opponent.focus')?.getAttribute('data-seat')).toBe('3');
    expect(document.querySelectorAll('.opponent.side')).toHaveLength(5);
  });

  it('the piles and the melds sit side by side in one centred row', () => {
    show({ hands: ['3S', '5H', '3C'], melds: [set(1, 1, 6, '6C 6D 6H.2')] });
    const board = document.querySelector('.center > .board') as HTMLElement;
    expect(board.querySelector('.piles')).toBeTruthy();
    expect(board.querySelector('.melds')).toBeTruthy();
  });

  it('the activity card sits at the bottom left, beside your window, so it cannot cover anything', () => {
    showLog();
    show({ hands: ['3S', '5H', '3C'] });
    const bottom = document.querySelector('.bottom') as HTMLElement;
    expect(bottom.querySelector('.mine')).toBeTruthy();
    expect(bottom.querySelector('.log')).toBeTruthy();
    expect(document.querySelector('.topbar .log')).toBeNull();
    expect(document.querySelector('.topbar .topbar-buttons')).toBeTruthy();
  });

  it('with several opponents the one whose turn it is is in the middle of a carousel, and clicking another brings them there', () => {
    show({ hands: ['3S', '5H', '3C', '4C'], current: 2 });
    const focus = () => document.querySelector('.opponents[data-carousel] .opponent.focus')?.getAttribute('data-seat');
    expect(focus()).toBe('2');
    expect(document.querySelectorAll('.opponent.side')).toHaveLength(2);
    fireEvent.click(document.querySelector('.opponent.side') as HTMLElement);
    expect(focus()).not.toBe('2');
  });
});
