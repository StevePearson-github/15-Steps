import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Action, type Card, FINAL_STEP, type Meld, type MeldSpec, extendMeld, findBase,
} from '../engine';
import { CardView } from './CardView';
import { ContextMenu } from './ContextMenu';
import { Hand, type HandHandle } from './Hand';
import {
  AVATARS, SORTERS, type Session, type SortDir, type SortKey, arrangeHand, baseFromSelection, canUndo,
  describeSpec, describeStep, humanSeat, seatColor, meldOptions, moveCards, orderForBuild, stagedMeetBase, stepKinds, verb,
} from './controller';

interface TableProps {
  session: Session;
  /** Perform a human action. Returns an error message, or null on success. */
  onAction: (action: Action) => string | null;
  onNewGame: () => void;
  /** Take back your last play this turn. */
  onUndo?: () => void;
  /** Controls for watching computers play (only used when there is no human seat). */
  watch?: { paused: boolean; onTogglePause: () => void; onStep: () => void };
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

export function Table({ session, onAction, onNewGame, onUndo, watch }: TableProps) {
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
  const [logOpen, setLogOpen] = useState(true);
  // Watching computers play: their hands are shown face-up unless you switch that off.
  const [showCards, setShowCards] = useState(true);
  const watching = me < 0;
  const playing = state.phase === 'draw' || state.phase === 'play';
  // The other players, in the order they take their turns after you (everyone, in seat order, when watching).
  const playerOrder = watching
    ? state.players.map((_, i) => i)
    : Array.from({ length: state.players.length - 1 }, (_, k) => (me + 1 + k) % state.players.length);
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
    if (!showSteps) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowSteps(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showSteps]);
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
  const [lastSort, setLastSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const sortBy = (key: SortKey, dir: SortDir) => {
    setOrder(SORTERS[key](fullHand, dir).map((c) => c.id));
    setLastSort({ key, dir });
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
      setMessage('No base to suggest yet.');
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
    } else if (selectionBase && run({ type: 'layBase', melds: selectionBase })) setStaged([]);
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
    <div className="frame">
    <div
      className="table"
      onPointerDown={(e) => {
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
          <strong>Round {state.round}</strong>
          <ul>
            {state.players.map((p, i) => (
              <li key={i} className={playing && state.current === i ? 'turn' : ''}>
                <span className="dot" style={{ background: seatColor(i) }} />
                <span className="sb-name">{seats[i]?.name}</span>
                <b>{p.score}</b>
              </li>
            ))}
          </ul>
          <span className="sb-note">Lowest score wins</span>
        </div>
        <div className="topbar-right">
          <div className="topbar-buttons">
            <button type="button" onClick={() => setShowSteps(true)}>The 15 steps</button>
            <button type="button" className="danger" onClick={onNewGame}>{watching ? 'Stop watching' : 'New game'}</button>
          </div>
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
        </div>
      </header>

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

      <section className="opponents" aria-label="Players">
        {playerOrder.map((i) => {
          const p = state.players[i];
          if (!p) return null;
          const active = playing && state.current === i;
          return (
            <div key={i} className={`opponent${active ? ' active' : ''}`} aria-current={active ? 'true' : undefined}>
              <span className="pill tab name">
                <span className="dot" style={{ background: seatColor(i) }} />
                {seats[i]?.name} <small>({seats[i]?.kind})</small>
                <span className="avatar" aria-hidden="true">{AVATARS[seats[i]?.kind ?? 'medium']}</span>
              </span>
              <div className="card-count" title={`${p.hand.length} cards in hand`}>✋ {p.hand.length}</div>
              <div className="opp-step">
                <strong>Step {p.step}:</strong> {describeStep(p.step)}
                {p.baseLaid ? <span className="base-down"> ✓ base down</span> : null}
              </div>
              <div className="opp-meta">{p.score} pts · <span className="count">{p.hand.length} cards</span></div>
              {active && <div className="turn-flag">▶ {state.phase === 'draw' ? 'Drawing' : 'Playing'}…</div>}
              {watching && showCards ? (
                <div className="reveal-hand" aria-label={`${seats[i]?.name}'s cards`}>
                  {arrangeHand(p.hand, []).map((c) => <CardView key={c.id} card={c} small />)}
                </div>
              ) : (
                <div className="back-fan" aria-hidden="true">
                  {p.hand.map((c) => <span key={c.id} className="back-card" />)}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="center">
        <div className="board">
        <div className="piles">
          <div>
            <CardView faceDown badge={state.stock.length} label={`Draw pile, ${state.stock.length} cards`} onClick={canDraw ? () => run({ type: 'drawStock' }) : undefined} />
            <div className="caption">Draw</div>
          </div>
          <div>
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
        <div className="status-pill" aria-live="polite">{turnText}</div>
      </section>
      {player && (
        <section className={`mine${myTurn ? ' active' : ''}`}>
          <span className="pill tab you">
            <span className="dot" style={{ background: seatColor(me) }} />
            {seats[me]?.name} <span className="avatar" aria-hidden="true">{AVATARS.human}</span>
          </span>
          <div className="goal">
            <strong>Step {player.step}:</strong> {describeStep(player.step)}
            {player.baseLaid ? ' ✓ base down' : ''} · {player.score} pts
          </div>

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

          {targets.length > 0 && (
            <div className="add-hint" role="status">
              {targets.length === 1 ? 'Your selected cards fit the gold meld on the table.' : `Your selected cards fit ${targets.length} gold melds on the table.`}{' '}
              Click a gold meld, or press its add button, to play them there.
            </div>
          )}
          <Hand ref={handRef} cards={hand} selected={selected} canSelect onToggle={toggle} onSelect={setSelected} onMove={move} />
          <div className="sort-row">
            <span className="hint">Drag cards to arrange them. Drag on the table to select several, then drag them together.</span>
            <button type="button" className="link" onClick={() => sortLink('suit')}>Sort by suit{arrow('suit')}</button>
            <button type="button" className="link" onClick={() => sortLink('rank')}>Sort by rank{arrow('rank')}</button>
            <button type="button" className="link" onClick={() => sortLink('sets')}>Sort by sets{arrow('sets')}</button>
            <button type="button" className="link" onClick={() => sortLink('runs')}>Sort by runs{arrow('runs')}</button>
            <span className="hint">(or right-click)</span>
          </div>

          {canPlay && (
            <div className="actions">
              {!player.baseLaid ? (
                <>
                  <button type="button" disabled={selectedCards.length < 2} onClick={stage}>Add as meld</button>
                  <button type="button" onClick={suggest}>Suggest base</button>
                  <button type="button" className="primary" disabled={!baseReady && !selectionBase} onClick={layBase}>Lay down base</button>
                </>
              ) : (
                <button type="button" disabled={selectedCards.length < 3} onClick={layNow}>Lay down selected</button>
              )}
              <button type="button" disabled={selectedCards.length !== 1} onClick={() => run({ type: 'discard', cardId: selected[0] as string })}>
                Discard selected
              </button>
              <button type="button" disabled={!undoable} onClick={doUndo} title="Take back your last play (Ctrl/Cmd+Z)">
                Undo
              </button>
            </div>
          )}
          {message && <p className="error" role="alert">{message}</p>}
        </section>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title="Arrange your hand"
          onClose={() => setMenu(null)}
          items={[
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

      {showSteps && (
        <div className="overlay" onClick={() => setShowSteps(false)}>
          <div className="dialog steps-card" role="dialog" aria-label="The 15 steps" onClick={(e) => e.stopPropagation()}>
            <h2>The 15 steps</h2>
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
