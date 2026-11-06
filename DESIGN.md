# 15 Steps — Design

Design for the digital version of 15 Steps. See [RULES.md](RULES.md) for the game rules, which are the source of truth for behavior.

## Goals

- Playable on as many platforms as possible: **Mac and Windows at minimum, Linux too**, with mobile and web as stretch goals.
- Players can be **human or AI in any mixture**, including all-AI games (AI vs AI).
- **Multiplayer (online) comes later**, but the design should not prevent it.
- **Testable throughout.** Every feature is built with tests, so new features can be added with confidence.

## Phases

1. **Rules engine and tests only** (no UI). _Done._
2. AI players (on top of the engine), with AI-vs-AI simulation. _Done._
3. UI (single-device play against AI and/or humans). _Minimal version done._
4. Packaging for each platform.
5. Online multiplayer.

## Proposed Stack

| Concern | Choice | Why |
|---------|--------|-----|
| Language | **TypeScript** | Runs in browsers, desktop shells and Node, so one engine serves every platform. |
| Engine | Pure TypeScript library, no UI or I/O dependencies | Easy to test, reusable for AI, UI and a future server. |
| Tests | **Vitest** (plus property-based tests with fast-check) | Fast, TypeScript-native. |
| UI (later) | Web UI (React or similar) | One codebase for web, desktop and mobile. |
| Desktop (later) | Tauri (or Electron) wrapping the web UI | Mac, Windows and Linux from the same UI. |
| Mobile (later) | PWA or Capacitor wrapping the web UI | Optional, no extra rewrite. |
| Multiplayer (later) | Node server reusing the same engine to validate moves | Server is authoritative. |

_Stack is a recommendation, open to change._

## Architecture

```
/engine      Pure game logic (no UI, no I/O, no global state)
/ai          AI players that choose actions using engine state
/sim         Headless runner for AI-vs-AI games and statistics
/ui          (later) Presentation layer
/server      (later) Multiplayer
/tests       Unit, scenario and property tests
```

### Engine principles

- **Pure and deterministic.** The engine is a state machine: `nextState = applyAction(state, action)`. It never mutates the input state and never reads the clock or random numbers directly.
- **Seeded randomness.** Shuffling uses an injectable seeded RNG, so any game can be replayed exactly from `seed + actions`.
- **Serializable state.** Game state and actions are plain JSON, so they can be saved, logged, sent over a network and used in tests.
- **Legal-move queries.** The engine can say which actions are legal in a given state, which AI players, the UI and tests all use.
- **Validation in one place.** All rule enforcement lives in the engine. The UI and AI cannot bypass it.
- **No hidden UI concepts.** The engine knows nothing about rendering, animation or networking.

### Core model (sketch)

- `Card`: rank, suit, or joker, plus a deck id so the two decks can be told apart.
- `Meld`: kind (set, run, pair), cards, and for wilds the fixed rank each stands for.
- `Player`: id, hand, current step, laid-down melds, base-laid flag, cumulative score.
- `Game`: players, stock, discard pile, dealer, turn, phase, step per player, round number.
- `Action`: `DrawFromStock`, `DrawFromDiscard`, `LayDownBase`, `LayDownMeld`, `BuildOnMeld`, `Discard`.
- Phases: `Draw`, `Play` (lay down, build), `Discard`, `RoundOver`, `GameOver`.

### Player interface

Every player, human or AI, implements the same interface: given a game state (as that player sees it) and the legal actions, return an action. This makes human, AI and mixed games (including all-AI) identical to the engine.

- Hidden information (other players' hands, stock order) is **filtered** out of the state given to a player.
- AI levels are pluggable (e.g. random legal moves, simple heuristic, stronger search).

## Testing Strategy

Testing is part of the definition of done for every feature.

- **Unit tests:** card values, set/run/pair validation (including wilds, ace low/high, no wrap-around, fixed wild values), step requirements for all 15 steps, scoring.
- **Scenario tests:** small, hand-built game states for each rule in RULES.md (building on melds, going out, stock reshuffle, step advancement, ties, Step 15 ending). Each rule gets at least one test that names the rule.
- **Property tests:** random legal play never produces an invalid state, card count is conserved (108 cards at all times), score only rises, the same seed and actions give the same result.
- **Full-game simulations:** AI-vs-AI games run to completion across many seeds, checking invariants and that games terminate.
- **Replay tests:** recorded `seed + actions` logs replay to the same final state (also used to reproduce bugs).
- **CI:** tests run on every change, on Mac, Windows and Linux, to catch platform differences early.

## Decisions and Assumptions

- The dealer cut bonus from the original game is **not implemented** (see RULES.md).
- The deck is 108 cards (two decks, four jokers).
- Save files include the seed, the action log and the current state, with a version number so older saves can be migrated.
- Variants (swapping wilds, deep discard pickup) are off by default and may become engine options later.

## Presentation Requirements (Later Phases)

These affect the UI layer only. The engine stays free of them, but exposes what they need.

- **Deck themes:** Multiple deck styles and card backs, selectable by the player. Only one is needed at first. The engine knows cards only by identity (rank, suit, joker), never appearance, so themes are pure UI assets.
- **Sound and music:** Sound effects and music, each with an option to disable. The engine's `applyAction` returns a list of **game events** (card drawn, meld laid, went out, and so on) alongside the new state, so audio and animation can hook in without touching the rules.
- **Graphics:** **2D**, smooth and flowing, with card animations driven by the same events.

## Visual Design

The look is a friendly, "sticker" card-game style: a wooden-framed felt table, thick navy outlines with a soft drop shadow on every object, a rounded typeface with big bold numerals, saturated flat colours, pills and badges, and dashed slots where cards go. It was inspired by a polished reference game, taking the design language (not its artwork or branding).

**Everything is built from tokens** at the top of `src/ui/styles.css`, so deck and table themes can be added later by overriding variables:

| Token group | Examples |
|---|---|
| Type | `--font` (Fredoka, bundled locally so it works offline, with the system's rounded font as a fallback) |
| Ink and colour | `--ink` (the outline navy), `--yellow`, `--coral`, `--blue`, `--cream` |
| Table | `--felt-light`, `--felt-dark`, `--wood-*`, `--panel` |
| Cards | `--card-face`, `--card-back-bg`, `--suit-red`, `--card-w` / `--small-w` (sizes) |

**Building blocks:** `.pill` (name tags with a seat-colour dot and a little avatar), `.badge` and `.card-count` (round counts), `.status-pill`, chunky buttons (outline, drop shadow, press), panels with an inner highlight, and `.card.empty` / `.slot-hint` dashed slots. Whoever is playing gets a yellow glow and a name tab.

**Cards:** each card's size is a multiple of one hundredth of its width, so one number (`--card-w`) resizes everything on it. A face shows a corner index (rank over suit) and a large suit in the middle; there is deliberately no upside-down second index, because a rotated 9 reads as a 6. Wild cards (2s and jokers) carry a WILD tag. The back is navy with polka dots and a red "15" emblem, and a pile shows a count badge. In the hand, cards overlap a little (their corner index stays readable) so a full hand fits on one row.

**Sizing:** one value, `--card-w`, follows the window (mostly its height, so the whole table fits the screen) and every other card size is a multiple of it: melds 0.86x, piles 1.2x, opponents' card backs 0.53x (0.65x for the player whose turn it is). The table fits without scrolling on a 1080p monitor, a 14" MacBook Pro, 1440x900, a 4K-class monitor and a tablet; a very short window or a phone scrolls. Don't use CSS `zoom` or scale transforms to fit the screen: the drag-and-drop code works in pixels and would drift.

**Readability:** the base size is 17px, small labels are at least 0.74rem and 600 weight, and nothing is dimmed below about 80%. Contrast was measured against the felt (WCAG AA is 4.5:1): the smallest dimmed labels were already 4.6 to 7 and the main text is 11.6, so the problem was size and thinness, not colour. Text on the felt has a faint shadow so it stays crisp.

**Accessibility:** every card has a spoken name ("queen of hearts", "2 of diamonds (wild)"), controls are real buttons with visible keyboard focus, and the turn text announces politely.

### Polish roadmap

1. ~~Foundation: tokens, font, frame and felt, cards, buttons, pills, badges, panels, status pill, scoreboard.~~ _Done._
2. ~~Motion~~ _Done_ (`src/ui/motion.ts`): dealing, drawing, discarding, laying and building melds, undo and hand sorting animate, for you and the computers; "Animate the cards" is in Options and `prefers-reduced-motion` is respected.
3. Chrome: a Menu button (steps, undo, new game) and a Sound button in the top corners; a polished setup screen and pop-ups; a window title and app icon.
4. Sound and music with an off switch (already planned).
5. Deck and table themes: a four-colour deck option, alternative card backs, felt colours.
6. Packaging: Mac and Windows done in 1.0.0 (Tauri, see RELEASING.md); Android done (compact landscape layout, max 4 players on a phone; the release workflow attaches a signed APK; not on the Play Store); Linux to come.

## Decisions (Confirmed)

- **Stack:** TypeScript for everything.
- **AI difficulty levels:** Easy, Medium and Hard.
- **Save and resume:** Games can be saved and resumed. This is straightforward since the game state is serializable JSON (and a game can also be rebuilt from `seed + actions`).
- **Wild display:** The UI does **not** overlay the represented rank on laid-down wilds. Players work out what a wild stands for, as in the physical game. (The engine still records each wild's fixed rank, which it needs to validate building.)

## Open Questions

None at this time.

## Status

**Phase 1, rules engine:** done (`src/engine`).
**Phase 2, AI players and simulation:** done (`src/ai`, `src/sim`).
**Phase 3, minimal playable UI:** done (`src/ui`). Sound and music are done (see below); themes are still to do.

Run `npm run dev` to play in the browser (`npm run build` makes a static build in `dist/`). Run `npm test` (386 tests, about 4 seconds) and `npm run typecheck`. Run `npm run sim -- 100` to play 100 AI-vs-AI games and print win rates.

### Engine (`src/engine`)

Cards and the 108-card deck, seeded shuffle, the 15 steps, set/run/pair validation, `resolveMeld` (works out what wilds stand for), laying a base, extra melds, building on any meld, going out, scoring, step advancement, win and tie handling, stock reshuffle, events, hidden-information player views, save/resume and replay, and a meld finder (`findBase`, `extraMelds`, `baseDistance`) used by the AI and later by UI hints.

### AI (`src/ai`) and simulation (`src/sim`)

- Every player, human or AI, implements `Player.decide(view)`. `runGame` plays any mix of players to the end, including all-AI games.
- **Easy:** draws and discards at random. **Medium:** plays well but makes a random draw or discard 15% of the time. **Hard:** never makes those mistakes. All levels lay down melds and build the same way.
- Over 150 mixed games (Easy, Medium and Hard together): Hard won 92, Medium 58, Easy 0. Tests enforce this ordering.
- The AI works toward the current step's base (`baseDistance`): it only takes a discard that brings the base closer, and never throws away a card the base needs.

### UI (`src/ui`)

A Vite + React + TypeScript web app, 2D, playable in any modern browser.

- **Setup screen:** your name, 1 to 5 computer opponents each at Easy, Medium or Hard, or a "watch the computers play" mode with no human seat (2 to 6 computers). A saved game can be continued. The first time, it defaults to a **2-player game: you against one Medium computer**. Every change is remembered immediately (name, number of opponents, each difficulty, watch-only) and restored the next time the program starts, even if you never press Start. Settings that are missing, corrupt or out of range fall back to the defaults, and a browser that blocks storage just doesn't remember; it never breaks the game.
- **Table:** three bands, sized to fit the window. **Top:** a compact scoreboard and the buttons with the activity card under them, then the other players in the order they take their turns after you. Each player's panel has a name pill with an avatar, a card-count badge, their **step with what it needs** ("Step 9: two runs of 3 + one set of 3 ✓ base down" - the same wording as your own panel), their score, and one card back per card in their hand. The player whose turn it is glows yellow with larger card backs and a pulsing "Drawing…/Playing…" tag, and this moves from player to player. **Middle:** the draw and discard piles (the biggest cards on the table) side by side with every meld laid down, grouped by owner, all centred, with whose turn it is in a pill below. **Bottom:** your hand, goal and buttons.
- **Activity card:** the log of what each player just did is a small card in the top right, under the buttons, in the top bar's own space so it can never cover anything (the last four actions, or two on a short screen, newest brightest). The – button folds it down to just the latest action.
- **Turn:** click the stock or the discard to draw. To lay your base, either select all its cards and press "Lay down base", or build it meld by meld with "Add as meld", or press "Suggest base" to have its cards selected for you. Afterwards "Lay down selected" lays more melds, and the buttons on each meld add selected cards to it (either end of a run). "Discard selected" ends the turn. If selected cards could mean more than one thing (e.g. a wild at either end of a run), you are asked which.
- **Adding to melds on the table:** with cards selected on your turn, every meld shows its add buttons (a run has "add low" and "add high"). They are disabled with a reason when you can't use them yet ("Draw a card first", "Lay down your own base first", or the cards don't fit that meld), and melds your selection does fit glow gold with a bright add button and a tip above your hand. You can also just click a gold meld to play the cards there (for a run that fits at both ends, press the end you want).
- **Arranging your hand:** drag any card (mouse or touch) and the other cards slide aside to open a gap. Drops land in the nearest slot, so no precision is needed, and you can let go anywhere. Your order is kept: new cards go on the end.
  - **Selecting several:** just drag from empty space, either in the hand row or on the empty board around it, to draw a selection box that selects every card it touches (a new box replaces the old selection). Hold **Shift** to add to the current selection instead, or to start the box on a card. Shift+click adds or removes one card. Dragging starts a box only from empty space: dragging a card moves the card. On a touch screen a finger scrolls the page, so there you tap cards to select them.
  - **Moving a group:** drag any selected card and the whole selection travels together, fanned under the pointer, and lands side by side in its original order. Dragging an unselected card moves only that card.
  - **Deselecting:** click an empty spot on the board to clear the selection. It only counts as a click if the press starts and ends on empty space without moving, so finishing a selection box or a drag over blank board never wipes the selection you just made. Buttons, cards, melds, the hand row and pop-ups are not "empty".
  - **Anytime:** arranging and selecting both work when it isn't your turn (the action buttons appear on your turn).
  - **Keyboard:** Shift+Left/Right moves the focused card, or the whole selection if it is part of one.
  - The layout is measured once when a drag starts and cards move only by transforms, so nothing shifts under the pointer.
- **The 15 steps card:** "Show the 15 steps" in the right-click menu (or the "The 15 steps" link at the top) opens a pop-up listing every step. Your step is highlighted, finished steps are dimmed, and a tag on each step shows which players are on it. Close it with the button, Escape, or a click outside.
- **Right-click menu:** right-click anywhere on the table. Each sort (sets, runs, suit, rank) opens a second level with **Ascending** and **Descending**; there is also Undo last play and Clear selection. Sets groups matching ranks (biggest first), runs lines up consecutive cards of a suit (longest first, an ace after a king), and descending is the exact reverse order. Aces always sort high (after the king). Wilds always go last. The sort links under the hand do the same, and pressing the same link again flips the direction (shown with ↑ or ↓). Keyboard: Up/Down move, Right opens the second level, Left or Escape closes it.
- **Undo:** the Undo button, Ctrl/Cmd+Z, or the right-click menu takes back your plays this turn (laying a base, laying a meld, adding to a meld), one at a time. A draw cannot be undone, since undo-and-redraw would let you peek at the stock for free, and a discard ends your turn.
- **Watching computers play (no human seat):** every computer's cards are shown face-up (a switch hides them), so you can follow their plans. A bar at the top has **Pause/Resume**, **Step** (plays one move while paused), and **Stop game** (also "Stop watching" at the top right) which returns to the setup screen. When a round ends, a banner shows the penalties instead of a pop-up, so the cards stay visible, and the next round starts by itself unless paused. Cards are only ever revealed when nobody is playing; in a game you play, opponents' cards stay hidden.
- **Saving:** the game autosaves to the browser after every move and can be resumed from the setup screen.
- **Structure:** `controller.ts` holds all the logic (seats, AI stepping, turning selections into actions, saving) and has no React in it. The components only display it. CSS colours and card sizes are variables (`--card-bg`, `--felt`, `--card-w` and so on), ready for deck themes. Cards are 116×164 px (80×112 for melds on the table), and the text, suit and rounding all scale from the card width, so changing `--card-w` resizes everything. They step down on narrower screens (84 px under 900 px wide, 56 px under 600 px). A hand of 14 cards wraps to two rows on a laptop screen.
- **Sound and music:** synthesised with Web Audio (`src/ui/audio.ts`, no audio files). Effects follow engine events (`Session.events`, transient, never saved); music is a generative loop. Separate on/off and volume for each, in Options and on the setup screen, saved to `localStorage` (`15steps.sound.v1`). Audio starts on the first click or key press (browser rule).
- **Not yet:** deck themes, animation polish, and online multiplayer.

### Lessons from simulation and play

- **Wilds shared between melds:** the base finder used to pick specific wild cards for each candidate meld, so two melds that each needed wilds both claimed the same card and the finder wrongly gave up (this is why "Suggest base" showed nothing for a hand with two sets and three wilds). Candidates now only count how many wilds they need, and distinct wild cards are handed out once the melds are chosen. It also tries every choice of natural cards, and counts how many copies of each card you hold (two decks mean duplicates), so melds competing for the same card are sorted out, including two melds that each use a different copy of the same card. A random-hands test found that last case after thousands of tries, and the finder's property tests now run with a fresh random seed each time. A property test builds random bases with random wilds and checks they are found, and another checks the finder and `baseDistance` always agree.

- A copy of the action log on every action made long games quadratically slow. The engine now shares the log, so games finish in around 100 ms.
- Two AIs could swap the same cards from the discard pile forever. AIs now take any given card from the discard pile at most once per round.
- Holding a finished base back to ambush opponents lost badly to laying it down at once, so no level does it. Whether to hold is a human strategy choice.

### Rules interpretations (confirmed)

1. A step's base meld may be larger than the minimum (a set of 4 satisfies "set of three"), and any meld can be expanded afterwards, e.g. a set of 4 to 5, or a run of 3 to 4, 5 and beyond. _(Confirmed.)_
2. Extra melds after the base are sets or runs of 3 or more. Cards can also be added to any laid-down meld, including pairs (which become sets). _(Starting a brand-new standalone pair after the base is not allowed.)_
3. The dealer rotates to the left each round. _(Confirmed.)_
4. You must always finish with a discard, so at least one card stays in hand until the final discard. You can lay down and build as much as you like otherwise. _(Confirmed.)_
5. Players never have to say what a wild stands for when only one reading is possible (`resolveMeld`). They choose only when it is ambiguous, e.g. three wilds together, or a wild that could sit at either end of a run. _(Confirmed.)_
6. You may discard the card you just took from the discard pile. _(Confirmed.)_
