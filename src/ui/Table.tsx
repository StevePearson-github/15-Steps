import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type Action, type Card, FINAL_STEP, type GameState, type Meld, type MeldSpec, extendMeld, baseDistance, findBase,
} from '../engine';
import { CardView } from './CardView';
import { ContextMenu } from './ContextMenu';
import { SoundControls, type SoundProps } from './SoundControls';
import { Hand, type HandHandle } from './Hand';
import { fitToWindow, resetFit } from './fit';
import { type Snapshot, captureCards, getMotionScale, motionAvailable, playMotion } from './motion';
import {
  AVATARS, SORTERS, loadUiOptions, saveUiOptions, sortHandSmart, type Session, type SortDir, type SortKey, arrangeHand, baseChoices, baseFromSelection, canUndo,
  describeSpec, describeStep, humanSeat, seatColor, meldOptions, moveCards, orderForBuild, stagedMeetBase, stepKinds, verb,
} from './controller';

interface TableProps {
  session: Session;
  /** Perform a human action. Returns an error message, or null on success. */
  onAction: (action: Action) => string | null;
  onNewGame: () => void;
  sound?: SoundProps;
  /** Take back your last play this turn. */
  onUndo?: () => void;
  /** Controls for watching computers play (only used when there is no human seat). */
  watch?: { paused: boolean; onTogglePause: () => void; onStep: () => void };
  /** The speed arrows, always on screen: how fast the computers play and the cards fly. */
  speed?: { label: string; canSlower: boolean; canFaster: boolean; onSlower: () => void; onFaster: () => void };
}

/** Things that are not "empty board": anything you can press, plus cards, melds, the hand and pop-ups. */
const NOT_EMPTY = 'button, a, input, select, textarea, label, .card, .meld, .hand, .log, .dialog, .overlay, .context-menu, [role="menu"], [role="dialog"]';
const isEmptySpot = (target: EventTarget | null) => target instanceof Element && !target.closest(NOT_EMPTY);
/** How far a press may wander and still count as a click. */
const CLICK_SLOP = 5;

interface Choice {
  title: string;
  options: MeldSpec[];
  apply: (spec: MeldSpec) => void;
}

export function Table({ session, onAction, onNewGame, onUndo, watch, speed, sound }: TableProps) {
  const { state, seats, log } = session;
  const me = humanSeat(session);
  const player = me >= 0 ? state.players[me] : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [staged, setStaged] = useState<MeldSpec[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [message, setMessage] = useState('');
  // The player's own card order (ids). Cards not listed yet go on the end.
  const [order, setOrder] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [options, setOptions] = useState(() => loadUiOptions());
  useEffect(() => saveUiOptions(options), [options]);

  // Card motion: note where every card is while rendering (the screen still shows the old layout),
  // then animate whatever moved as soon as the new layout is in place.
  const rootRef = useRef<HTMLDivElement>(null);
  const motion = useRef<{ snap: Snapshot | null; prev: GameState | null }>({ snap: null, prev: null });
  const animating = options.animations && motionAvailable();
  motion.current.snap = animating && rootRef.current ? captureCards(rootRef.current) : null;
  // Keep the table inside the window (see fit.ts). This runs before the motion effect, so cards are measured at their final size.
  useLayoutEffect(() => fitToWindow());
  useEffect(() => {
    window.addEventListener('resize', fitToWindow);
    return () => {
      window.removeEventListener('resize', fitToWindow);
      resetFit();
    };
  }, []);
  useLayoutEffect(() => {
    const m = motion.current;
    if (animating && rootRef.current) playMotion({ root: rootRef.current, snap: m.snap, prev: m.prev, next: state, me });
    m.prev = state;
  });
  const [logOpen, setLogOpen] = useState(true);
  // Watching computers play: their hands are shown face-up unless you switch that off.
  const [showCards, setShowCards] = useState(true);
  const watching = me < 0;
  const playing = state.phase === 'draw' || state.phase === 'play';
  // The other players, in the order they take their turns after you (everyone, in seat order, when watching).
  const playerOrder = watching
    ? state.players.map((_, i) => i)
    : Array.from({ length: state.players.length - 1 }, (_, k) => (me + 1 + k) % state.players.length);
  // Carousel: with several opponents, the one whose turn it is (or who just played, when it is your turn) is shown large in the middle,
  // with the others smaller to the left and right in turn order. Clicking a smaller one brings it to the middle until the turn moves on.
  const carousel = playerOrder.length >= 2;
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => setPinned(null), [state.current]);
  const natural = playerOrder.includes(state.current) ? state.current : (playerOrder[playerOrder.length - 1] as number);
  const focus = pinned !== null && playerOrder.includes(pinned) ? pinned : natural;
  const shown = (() => {
    if (!carousel) return playerOrder;
    const k = playerOrder.indexOf(focus);
    const mid = Math.floor(playerOrder.length / 2);
    return playerOrder.map((_, j) => playerOrder[(k - mid + j + playerOrder.length * 2) % playerOrder.length] as number);
  })();
  // When the carousel turns, each window slides from where it was to where it is now.
  const oppRects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const els = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.opponents[data-carousel] .opponent') ?? []);
    const scale = getMotionScale();
    const next = new Map<string, DOMRect>();
    for (const el of els) {
      // Measure where each window really is, not where an unfinished slide has it.
      if (typeof el.getAnimations === 'function') for (const a of el.getAnimations()) if (a.id === 'carousel') a.cancel();
      const key = el.dataset.seat ?? '';
      const rect = el.getBoundingClientRect();
      next.set(key, rect);
      const prev = oppRects.current.get(key);
      // At the fastest speeds the turns come quicker than a slide takes, so the windows just jump.
      if (options.animations && scale >= 0.5 && prev && Math.abs(prev.left - rect.left) > 2 && typeof el.animate === 'function') {
        const a = el.animate([{ transform: `translateX(${prev.left - rect.left}px)` }, { transform: 'translateX(0)' }], { duration: Math.round(380 * scale), easing: 'ease-in-out' });
        a.id = 'carousel';
      }
    }
    oppRects.current = next;
  }, [focus, shown.join(','), options.animations]);
  // A press that starts and ends on empty board, without moving, clears the selection.
  const emptyPress = useRef<{ x: number; y: number } | null>(null);
  const handRef = useRef<HandHandle>(null);

  const myTurn = me >= 0 && state.current === me;
  const canDraw = myTurn && state.phase === 'draw';
  const canPlay = myTurn && state.phase === 'play';
  const stagedIds = useMemo(() => new Set(staged.flatMap((s) => s.cardIds)), [staged]);
  const fullHand = player?.hand ?? [];
  const hand = useMemo(
    () => arrangeHand(fullHand, order).filter((c) => !stagedIds.has(c.id)),
    [fullHand, order, stagedIds],
  );
  const selectedCards = hand.filter((c) => selected.includes(c.id));
  const top = state.discard.at(-1);

  const undoable = !!onUndo && canUndo(session);
  const doUndo = () => {
    if (!onUndo || !canUndo(session)) return;
    onUndo();
    setSelected([]);
    setStaged([]);
    setMessage('');
  };
  useEffect(() => {
    if (!showSteps && !showOptions) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowSteps(false);
      setShowOptions(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showSteps, showOptions]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const run = (action: Action): boolean => {
    const error = onAction(action);
    setMessage(error ?? '');
    if (!error) {
      setSelected([]);
      return true;
    }
    return false;
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const move = (group: string[], insertAt: number) => {
    const shown = hand.map((c) => c.id);
    const hidden = arrangeHand(fullHand, order).map((c) => c.id).filter((x) => stagedIds.has(x)); // staged cards
    setOrder([...moveCards(shown, group, insertAt), ...hidden]);
  };
  // Pressing the same sort link again flips between ascending and descending.
  const [lastSort, setLastSort] = useState<{ key: SortKey | 'smart'; dir: SortDir } | null>(null);
  const sortBy = (key: SortKey, dir: SortDir) => {
    setOrder(SORTERS[key](fullHand, dir).map((c) => c.id));
    setLastSort({ key, dir });
  };
  const smartSort = () => {
    if (!player) return;
    setOrder(sortHandSmart(fullHand, player.step, player.baseLaid).map((c) => c.id));
    setLastSort({ key: 'smart', dir: 'asc' });
  };
  const sortLink = (key: SortKey) => sortBy(key, lastSort?.key === key && lastSort.dir === 'asc' ? 'desc' : 'asc');
  const arrow = (key: SortKey) => (lastSort?.key === key ? (lastSort.dir === 'asc' ? ' ↑' : ' ↓') : '');

  const offer = (title: string, options: MeldSpec[], apply: (spec: MeldSpec) => void) => {
    if (options.length === 0) setMessage("Those cards don't make a valid set, run or pair.");
    else if (options.length === 1) apply(options[0] as MeldSpec);
    else setChoice({ title, options, apply });
  };

  const stage = () =>
    offer('What are these cards?', meldOptions(selectedCards, true, player ? stepKinds(player.step) : undefined), (spec) => {
      setStaged((s) => [...s, spec]);
      setSelected([]);
      setMessage('');
    });

  const layNow = () =>
    offer('What are these cards?', meldOptions(selectedCards, false), (spec) => {
      run({ type: 'layMeld', meld: spec });
    });

  // Suggest a base by selecting its cards in your hand, exactly as if you had picked them yourself.
  const suggest = () => {
    const base = findBase(fullHand, player?.step ?? 1);
    if (!base) {
      const missing = baseDistance(fullHand, player?.step ?? 1);
      setMessage(missing > 0 ? `No base to suggest yet: you are missing ${missing} ${missing === 1 ? 'card' : 'cards'}.` : 'No base to suggest yet.');
      return;
    }
    setStaged([]);
    setSelected(base.flatMap((m) => m.cardIds));
    setMessage('');
  };

  // Lay down what you staged, or else the cards you have selected if they make up the base.
  const selectionBase = player && selectedCards.length > 0 ? baseFromSelection(selectedCards, player.step) : null;
  const layBase = () => {
    if (baseReady) {
      if (run({ type: 'layBase', melds: staged })) setStaged([]);
    } else if (selectionBase && player) {
      // Where the cards could be read more than one way (a wild at the end of a run), ask which one is meant.
      const choices = baseChoices(selectedCards, player.step) ?? selectionBase.map((m) => [m]);
      const pick = (i: number, chosen: MeldSpec[]) => {
        const options = choices[i];
        if (!options) {
          if (run({ type: 'layBase', melds: chosen })) setStaged([]);
          return;
        }
        offer(options[0]?.kind === 'run' ? 'Which run is this?' : 'What are these cards?', options, (spec) => pick(i + 1, [...chosen, spec]));
      };
      pick(0, []);
    }
  };

  const build = (meld: Meld, side?: 'low' | 'high') => {
    const ordered = orderForBuild(meld, selectedCards, side);
    if (!ordered) return setMessage("Those cards don't fit there.");
    run({ type: 'build', meldId: meld.id, cardIds: ordered.map((c) => c.id), ...(side ? { side } : {}) });
  };

  const baseReady = !!player && stagedMeetBase(staged, fullHand, player.step);

  // Why the selected cards can't be added to melds yet (null when they can).
  const addBlocker: string | null = !myTurn
    ? null
    : state.phase === 'draw'
      ? 'Draw a card first'
      : !player?.baseLaid
        ? 'Lay down your own base first'
        : null;
  /** Would these cards fit this meld at this end? (Sets have no ends.) */
  const fits = (m: Meld, side?: 'low' | 'high'): boolean => {
    const ordered = orderForBuild(m, selectedCards, side);
    return !!ordered && ordered.length > 0 && extendMeld(m, ordered, side).ok;
  };
  /** The single way to add the selection to a meld, if there is exactly one (used when the whole meld is clicked). */
  const onlyWay = (m: Meld): { side?: 'low' | 'high' } | null => {
    if (addBlocker || !myTurn || selectedCards.length === 0) return null;
    if (m.kind !== 'run') return fits(m) ? {} : null;
    const low = fits(m, 'low');
    const high = fits(m, 'high');
    return low && !high ? { side: 'low' } : high && !low ? { side: 'high' } : null;
  };
  const targets = state.melds.filter((m) => !addBlocker && myTurn && selectedCards.length > 0 && (m.kind === 'run' ? fits(m, 'low') || fits(m, 'high') : fits(m)));

  const turnText =
    state.phase === 'gameOver'
      ? 'Game over'
      : `${myTurn ? 'Your' : `${seats[state.current]?.name}'s`} turn${myTurn ? (state.phase === 'draw' ? ' — draw a card' : ' — play, then discard') : ''}${watching && watch?.paused ? ' (paused)' : ''}`;

  return (
    <div className="frame" ref={rootRef}>
    <div
      className="table"
      onPointerDown={(e) => {
        // A pop-up message (like "No base to suggest yet.") goes away at the next click anywhere.
        setMessage((m) => (m ? '' : m));
        const empty = e.button === 0 && isEmptySpot(e.target);
        emptyPress.current = empty ? { x: e.clientX, y: e.clientY } : null;
        // Dragging from empty board draws a selection box over the hand (a mouse or pen; a finger scrolls instead).
        if (empty && player && e.pointerType !== 'touch') handRef.current?.beginBox(e);
      }}
      onPointerUp={(e) => {
        const start = emptyPress.current;
        emptyPress.current = null;
        if (start && isEmptySpot(e.target) && Math.hypot(e.clientX - start.x, e.clientY - start.y) < CLICK_SLOP) {
          setSelected((sel) => (sel.length === 0 ? sel : []));
        }
      }}
      onContextMenu={(e) => {
        if (!player) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <header className="topbar">
        <div className="scoreboard" aria-label="Scores">
          <div className="logo" aria-hidden="true">15 Steps</div>
          <strong>Round {state.round}</strong>
          <ul>
            {state.players.map((p, i) => (
              <li key={i} className={playing && state.current === i ? 'turn' : ''}>
                <span className="dot" style={{ background: seatColor(i) }} />
                <span className="sb-name">{seats[i]?.name}</span>
                <span className="sb-step">Step {p.step}</span>
                <b>{p.score}</b>
              </li>
            ))}
          </ul>
          <span className="sb-note">Lowest score wins</span>
        </div>
        {(state.phase === 'gameOver' || (watching && watch?.paused)) && <div className="status-pill" aria-live="polite">{turnText}</div>}
    {watching && watch && (
      <section className="watch-bar" aria-label="Watching controls">
        <button type="button" className="primary" onClick={watch.onTogglePause} aria-pressed={watch.paused}>
          {watch.paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <button type="button" onClick={watch.onStep} disabled={!watch.paused || state.phase === 'gameOver'} title="Play one move">
          Step
        </button>
        <label>
          <input type="checkbox" checked={showCards} onChange={(e) => setShowCards(e.target.checked)} /> Show the computers’ cards
        </label>
        <button type="button" onClick={onNewGame}>Stop game</button>
      </section>
    )}
        <div className="topbar-right">
          <div className="topbar-buttons">
            {speed && (
              <span className="speed" role="group" aria-label="Speed" title="How fast the computers play">
                <span className="speed-title">Speed</span>
                <button type="button" className="arrow" aria-label="Slower" title="Slower" disabled={!speed.canSlower} onClick={speed.onSlower}>◀</button>
                <span className="speed-label" aria-live="polite">{speed.label}</span>
                <button type="button" className="arrow" aria-label="Faster" title="Faster" disabled={!speed.canFaster} onClick={speed.onFaster}>▶</button>
              </span>
            )}
            <button type="button" onClick={() => setShowOptions(true)}>Options</button>
            <button type="button" onClick={() => setShowSteps(true)}>15 steps</button>
            <button type="button" className="danger" onClick={onNewGame}>{watching ? 'Stop watching' : 'New game'}</button>
          </div>
        </div>
      </header>

      <section className="opponents" aria-label="Players" data-count={Math.min(playerOrder.length, 5)} data-carousel={carousel ? 1 : undefined}>
        {/* The middle window stays in the exact middle: an empty spacer fills in for any side window the other side has and this one lacks. */}
        {carousel && shown.indexOf(focus) < shown.length - 1 - shown.indexOf(focus) && <div className="opp-spacer" aria-hidden="true" style={{ flex: `${shown.length - 1 - 2 * shown.indexOf(focus)} 1 0`, maxWidth: 290 * (shown.length - 1 - 2 * shown.indexOf(focus)) }} />}
        {shown.map((i) => {
          const p = state.players[i];
          if (!p) return null;
          const active = playing && state.current === i;
          return (
            <div key={i} data-seat={i} className={`opponent${active ? ' active' : ''}${carousel ? (i === focus ? ' focus' : ' side') : ''}`} aria-current={active ? 'true' : undefined}
              onClick={carousel && i !== focus ? () => setPinned(i) : undefined}>
              <div className="opp-bar">
                <span className="pill tab name">
                  <span className="dot" style={{ background: seatColor(i) }} />
                  {seats[i]?.name} <small>({seats[i]?.kind})</small>
                  <span className="avatar" aria-hidden="true">{AVATARS[seats[i]?.kind ?? 'medium']}</span>
                </span>
                <span className="pill step-pill" title={`Step ${p.step}: ${describeStep(p.step)}`}>
                  <span className="step-text"><strong>Step {p.step}</strong><span className="pd">: {describeStep(p.step)}</span></span>
                  {p.baseLaid ? <span className="base-down" title="Base is down">✓<span className="bd-text"> base down</span></span> : null}
                </span>
              </div>
              <div className="opp-desc" title={describeStep(p.step)}>{describeStep(p.step)}</div>
              {watching && showCards && (!carousel || i === focus) ? (
                <div className="reveal-hand" data-region={`reveal-${i}`} aria-label={`${seats[i]?.name}'s cards`}>
                  {arrangeHand(p.hand, []).map((c) => <CardView key={c.id} card={c} small />)}
                </div>
              ) : (
                <div className="back-fan" aria-hidden="true" style={{ '--n': Math.max(p.hand.length - 1, 1) } as CSSProperties}>
                  {p.hand.map((c, k) => (
                    <span key={c.id} className="back-card">
                      {k === p.hand.length - 1 && <span className="emblem"><b>15</b><i>steps</i></span>}
                    </span>
                  ))}
                </div>
              )}
              <div className="opp-meta">
                <span>{p.score} pts · <span className="count">{p.hand.length} {p.hand.length === 1 ? 'card' : 'cards'}</span></span>
                {active && <span className="turn-flag">▶ {state.phase === 'draw' ? 'Drawing' : 'Playing'}…</span>}
              </div>
            </div>
          );
        })}
        {carousel && shown.indexOf(focus) > shown.length - 1 - shown.indexOf(focus) && <div className="opp-spacer" aria-hidden="true" style={{ flex: `${2 * shown.indexOf(focus) - (shown.length - 1)} 1 0`, maxWidth: 290 * (2 * shown.indexOf(focus) - (shown.length - 1)) }} />}
      </section>

      <section className="center">
        <div className="board">
        <div className="piles">
          <div data-region="draw">
            <CardView faceDown badge={state.stock.length} label={`Draw pile, ${state.stock.length} cards`} onClick={canDraw ? () => run({ type: 'drawStock' }) : undefined} />
            <div className="caption">Draw</div>
          </div>
          <div data-region="discard">
            {top ? (
              <CardView card={top} onClick={canDraw ? () => run({ type: 'drawDiscard' }) : undefined} label="Take the discard" />
            ) : (
              <div className="card empty" aria-label="Discard pile is empty" />
            )}
            <div className="caption">Discard</div>
          </div>
        </div>
        <div className="melds">
          {state.melds.length === 0 && <div className="slot-hint">Melds laid down by anyone will appear here</div>}
          {state.melds.length > 0 && myTurn && selectedCards.length > 0 && addBlocker && (
            <p className="hint notice">{addBlocker} before adding cards to melds on the table.</p>
          )}
          {state.players.map((p, owner) => {
            const melds = state.melds.filter((m) => m.owner === owner);
            if (melds.length === 0) return null;
            return (
              <div key={owner} className="owner-melds">
                <div className="owner"><span className="dot" style={{ background: seatColor(owner) }} />{seats[owner]?.name}</div>
                <div className="meld-row">
                  {melds.map((m) => (
                    <div
                      key={m.id}
                      className={`meld${targets.includes(m) ? ' fits' : ''}${onlyWay(m) ? ' clickable' : ''}`}
                      data-meld={m.id}
                      data-region={`meld-${m.id}`}
                      onClick={() => {
                        const way = onlyWay(m);
                        if (way) build(m, way.side);
                      }}
                    >
                      <div className="meld-cards">
                        {m.cards.map((c) => <CardView key={c.id} card={c} small />)}
                      </div>
                      {myTurn && selectedCards.length > 0 && (
                        <div className="meld-actions" onClick={(e) => e.stopPropagation()}>
                          {m.kind === 'run' ? (
                            <>
                              <button type="button" disabled={!!addBlocker || !fits(m, 'low')} title={addBlocker ?? (fits(m, 'low') ? '' : "These cards don't fit this end")} onClick={() => build(m, 'low')}>◀ add low</button>
                              <button type="button" disabled={!!addBlocker || !fits(m, 'high')} title={addBlocker ?? (fits(m, 'high') ? '' : "These cards don't fit this end")} onClick={() => build(m, 'high')}>add high ▶</button>
                            </>
                          ) : (
                            <button type="button" disabled={!!addBlocker || !fits(m)} title={addBlocker ?? (fits(m) ? '' : "These cards don't fit this meld")} onClick={() => build(m)}>+ add</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </section>
      <div className="bottom">
        {options.showActivity && (
        <section className={`log${logOpen ? '' : ' collapsed'}`} aria-label="Activity" aria-live="polite">
          <div className="log-head">
            <span>Activity</span>
            <button
              type="button"
              className="log-toggle"
              aria-label={logOpen ? 'Hide activity' : 'Show activity'}
              aria-expanded={logOpen}
              onClick={() => setLogOpen((o) => !o)}
            >
              {logOpen ? '–' : '+'}
            </button>
          </div>
          <div className="log-lines">
            {log.slice(logOpen ? -4 : -1).map((l, i, all) => (
              <div key={`${log.length}-${i}`} className={i === all.length - 1 ? 'latest' : ''}>{l}</div>
            ))}
          </div>
        </section>
        )}
      {player && (
        <section className={`mine${myTurn ? ' active' : ''}`}>
          <span className="pill tab you">
            <span className="dot" style={{ background: seatColor(me) }} />
            {seats[me]?.name} <span className="avatar" aria-hidden="true">{AVATARS.human}</span>
          </span>
          <span className="pill step-pill mine-step" title={`Step ${player.step}: ${describeStep(player.step)}`}>
            <span className="step-text"><strong>Step {player.step}:</strong> {describeStep(player.step)}</span>
            {player.baseLaid ? <span className="base-down" title="Base is down">✓ base down</span> : null}
          </span>
          <div className="goal">
            <span className="goal-step">{player.score} pts</span>
            {canPlay && !player.baseLaid && (
              <div className="staging">
                <span>Base:</span>
                {staged.length === 0 && <span className="hint">Select all your base cards and press “Lay down base”, or build it meld by meld with “Add as meld”.</span>}
                {staged.map((s, i) => (
                  <span key={i} className="staged">
                    {describeSpec(s)}{' '}
                    <button type="button" className="link" aria-label="remove" onClick={() => setStaged((x) => x.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
            {myTurn && state.phase === 'draw' && <div className="status-pill in-hand" aria-live="polite">{selected.length > 0 ? 'Draw a card first — then you can lay these down' : turnText}</div>}
            <span className="tip" title="Drag cards to arrange them, or drag on the table to select several. Right-click for more.">Drag to arrange · right-click for more</span>
            {targets.length > 0 && (
              <div className="add-hint" role="status">
                {targets.length === 1 ? 'Your selected cards fit the gold meld on the table.' : `Your selected cards fit ${targets.length} gold melds on the table.`}{' '}
                Click a gold meld, or press its add button, to play them there.
              </div>
            )}
          </div>
          <Hand ref={handRef} cards={hand} selected={selected} canSelect onToggle={toggle} onSelect={setSelected} onMove={move} />
          <div className="controls">
          <div className="sort-row">
            <span className="sort-label">Sort</span>
            <button type="button" className={`sort-btn smart${lastSort?.key === 'smart' ? ' on' : ''}`} onClick={smartSort} aria-label="Smart sort">Smart</button>
            <button type="button" className={`sort-btn${lastSort?.key === 'suit' ? ' on' : ''}`} onClick={() => sortLink('suit')} aria-label={`Sort by suit${arrow('suit')}`}>Suit{arrow('suit')}</button>
            <button type="button" className={`sort-btn${lastSort?.key === 'rank' ? ' on' : ''}`} onClick={() => sortLink('rank')} aria-label={`Sort by rank${arrow('rank')}`}>Rank{arrow('rank')}</button>
            <button type="button" className={`sort-btn${lastSort?.key === 'sets' ? ' on' : ''}`} onClick={() => sortLink('sets')} aria-label={`Sort by sets${arrow('sets')}`}>Sets{arrow('sets')}</button>
            <button type="button" className={`sort-btn${lastSort?.key === 'runs' ? ' on' : ''}`} onClick={() => sortLink('runs')} aria-label={`Sort by runs${arrow('runs')}`}>Runs{arrow('runs')}</button>
          </div>

          {/* Always shown so they never seem to come and go; they are greyed out until it is your turn and you have drawn. */}
          <div className="actions">
            {!player.baseLaid ? (
              <>
                <button type="button" disabled={!canPlay || selectedCards.length < 2} onClick={stage}>Add as meld</button>
                <button type="button" disabled={!myTurn} onClick={suggest}>Suggest base</button>
                <button type="button" className="primary" disabled={!canPlay || (!baseReady && !selectionBase)} title={myTurn && state.phase === 'draw' ? 'Draw a card first, then you can lay your base down' : undefined} onClick={layBase}>Lay down base</button>
              </>
            ) : (
              <button type="button" disabled={!canPlay || selectedCards.length < 3} onClick={layNow}>Lay down selected</button>
            )}
            <button type="button" disabled={!canPlay || selectedCards.length !== 1} onClick={() => run({ type: 'discard', cardId: selected[0] as string })}>
              Discard selected
            </button>
            <button type="button" disabled={!canPlay || !undoable} onClick={doUndo} title="Take back your last play (Ctrl/Cmd+Z)">
              Undo
            </button>
          </div>
          </div>
          {message && <p className="error" role="alert">{message}</p>}
        </section>
      )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title="Arrange your hand"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Smart sort', onSelect: smartSort },
            ...(['sets', 'runs', 'suit', 'rank'] as SortKey[]).map((key) => ({
              label: `Sort by ${key}`,
              children: [
                { label: 'Ascending', onSelect: () => sortBy(key, 'asc') },
                { label: 'Descending', onSelect: () => sortBy(key, 'desc') },
              ],
            })),
            { label: 'Show the 15 steps', onSelect: () => setShowSteps(true) },
            { label: 'Undo last play', onSelect: doUndo, disabled: !undoable },
            { label: 'Clear selection', onSelect: () => setSelected([]), disabled: selected.length === 0 },
          ]}
        />
      )}

      {showOptions && (
        <div className="overlay" onClick={() => setShowOptions(false)}>
          <div className="dialog options-card" role="dialog" aria-label="Options" onClick={(e) => e.stopPropagation()}>
            <h2>Options</h2>
            <label className="option-row">
              <input
                type="checkbox"
                checked={options.showActivity}
                onChange={(e) => setOptions({ ...options, showActivity: e.target.checked })}
              />
              <span>
                <strong>Show the activity window</strong>
                <span className="hint">A short log of recent plays, top right.</span>
              </span>
            </label>
            <label className="option-row">
              <input
                type="checkbox"
                checked={options.animations}
                onChange={(e) => setOptions({ ...options, animations: e.target.checked })}
              />
              <span>
                <strong>Animate the cards</strong>
                <span className="hint">Cards glide, fly and flip into place.</span>
              </span>
            </label>
            {sound && <SoundControls {...sound} />}
            <button type="button" className="primary" onClick={() => setShowOptions(false)}>Close</button>
          </div>
        </div>
      )}

      {showSteps && (
        <div className="overlay" onClick={() => setShowSteps(false)}>
          <div className="dialog steps-card" role="dialog" aria-label="15 steps" onClick={(e) => e.stopPropagation()}>
            <h2>15 steps</h2>
            <p className="hint">Lay down each step's base to move on to the next. Lowest score wins once Step {FINAL_STEP} is done.</p>
            <ol className="steps-list">
              {Array.from({ length: FINAL_STEP }, (_, i) => i + 1).map((n) => {
                const here = state.players.flatMap((p, idx) => (p.step === n ? [idx] : []));
                const mine = player?.step === n;
                return (
                  <li key={n} className={mine ? 'current' : player && n < player.step ? 'done' : ''} aria-current={mine ? 'step' : undefined}>
                    <span className="step-no">{n}</span>
                    <span className="step-what">{describeStep(n)}</span>
                    <span className="step-who">
                      {here.map((idx) => (
                        <span key={idx} className={`chip${idx === me ? ' me' : ''}`}>{seats[idx]?.name}</span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ol>
            <button type="button" className="primary" onClick={() => setShowSteps(false)}>Close</button>
          </div>
        </div>
      )}

      {choice && (
        <div className="overlay" role="dialog" aria-label={choice.title}>
          <div className="dialog">
            <h2>{choice.title}</h2>
            <div className="options">
              {choice.options.map((o, i) => (
                <button key={i} type="button" onClick={() => { const c = choice; setChoice(null); c.apply(o); }}>
                  {describeSpec(o)}
                </button>
              ))}
            </div>
            <button type="button" className="link" onClick={() => setChoice(null)}>Cancel</button>
          </div>
        </div>
      )}

      {watching && state.phase === 'roundOver' && (
        <div className="round-banner" role="status">
          <strong>Round over.</strong> {seats[state.lastRound?.wentOut ?? 0]?.name} went out. Penalties:{' '}
          {state.players.map((_, i) => `${seats[i]?.name} ${state.lastRound?.penalties[i]}`).join(', ')}.{' '}
          {watch?.paused ? 'Paused: press Resume or Step for the next round.' : 'The next round starts in a moment…'}
        </div>
      )}

      {!watching && state.phase === 'roundOver' && (
        <div className="overlay" role="dialog" aria-label="Round over">
          <div className="dialog">
            <h2>Round over</h2>
            <p>{seats[state.lastRound?.wentOut ?? 0]?.name} went out.</p>
            <table>
              <thead><tr><th>Player</th><th>Penalty</th><th>Total</th><th>Next step</th></tr></thead>
              <tbody>
                {state.players.map((p, i) => (
                  <tr key={i}>
                    <td>{seats[i]?.name}</td>
                    <td>{state.lastRound?.penalties[i]}</td>
                    <td>{p.score}</td>
                    <td>{p.step}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" onClick={() => onAction({ type: 'nextRound' })}>Next round</button>
          </div>
        </div>
      )}

      {state.phase === 'gameOver' && (
        <div className="overlay" role="dialog" aria-label="Game over">
          <div className="dialog">
            <h2>{seats[state.winner ?? 0]?.name} {verb(seats[state.winner ?? 0]?.name ?? '', 'win', 'wins')}!</h2>
            <table>
              <tbody>
                {state.players.map((p, i) => (
                  <tr key={i}><td>{seats[i]?.name}</td><td>{p.score} pts</td></tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="primary" onClick={onNewGame}>New game</button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

export type { Card };
