# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A digital version of the family card game **15 Steps** (a Liverpool-style rummy game for 2 to 6 players; two decks including jokers). TypeScript, a pure rules engine, computer players, and a 2D React web UI. **`RULES.md` is the source of truth for the rules** (every ambiguity was settled with the owner, so don't guess; if something isn't in it, ask). `DESIGN.md` holds the status, the confirmed decisions, the visual design system, and the roadmap.

## Commands

```
npm run dev            # Vite dev server (the game, in a browser)
npm test               # all tests (vitest run, ~8 s)
npm run typecheck      # tsc --noEmit (run it: tests don't type-check)
npm run build          # production build to dist/
npm run sim -- 100     # 100 AI-vs-AI games, prints win rates per difficulty
npx vitest run tests/finder.test.ts          # one file
npx vitest run -t "wild cards shared"        # tests by name
```

There is no linter. Run `npm run typecheck` and `npm test` before finishing any change.

## Architecture

Three layers; each only depends on the one above it.

1. **`src/engine/`: pure, deterministic rules (no UI, no I/O).**
   - `game.ts` is a state machine: `applyAction(state, action)` returns `{ ok, state, events }` or `{ ok:false, error }`. It never mutates its input and never reads the clock or `Math.random`. Shuffling uses a serializable RNG whose state lives in `GameState.rngState`, so `seed + actions` replays a game exactly (`save.ts`: `replay`, `serializeGame`). Events (card drawn, meld laid, went out…) exist so sound and animation can hook in later.
   - `melds.ts` / `resolve.ts`: a meld is described explicitly by a `MeldSpec` (a set or pair names its `rank`; a run names its `suit` and `start`, positions 1 to 14 where 1 and 14 are both Ace). The engine never guesses what a wild stands for. `resolveMeld` works out the readings from a bag of cards and only returns more than one when it is genuinely ambiguous (e.g. three wilds).
   - `finder.ts`: finds a step's base from a hand, used by the AI and the UI's "Suggest base". **`findBase` and `baseDistance` share one search (`searchBase`) and must always agree**; a property test enforces this. Candidates use abstract wilds (`?`) and card *kinds* (`"5:H"`), not specific cards, and real cards are assigned only after the melds are chosen. Don't bind candidates to concrete card ids: two melds then both claim the same wild or the same copy of a duplicated card, and the search wrongly fails (this bug happened twice).
   - `view.ts`: `viewFor(state, seat)` hides other hands and the stock. Computer players and the UI only ever see this.
2. **`src/ai/` and `src/sim/`**: a `Player` is `decide(view) => Action`, one action at a time, re-planned from scratch on each call. `plan.ts` plans a whole turn (base, extra melds, builds) and never plays the last card (a discard is mandatory). Difficulty is only a mistake rate (`MISTAKE_RATE`) on top of the same strategy. `sim/run.ts` plays any mix of players to the end; the same code runs all-AI games.
3. **`src/ui/`: React, but all logic is in `controller.ts` (no React in it).** A `Session` = `{ state, seats, log, undoStack }`; `apply`/`aiStep`/`undo`, save/load, new-game preferences, sorting, drag helpers and selection-to-meld helpers all live there so they can be unit tested. `App.tsx` owns timers (computer moves, pause/step when watching) and autosave to `localStorage`. `Table.tsx` holds UI state (selection, staged melds, hand order, menus). `Hand.tsx` is the drag-and-drop hand. `styles.css` is a token-based design system.

## Things that are easy to get wrong

- **Rules interpretations in the engine** (see `RULES.md` and `DESIGN.md` "confirmed"): a step's base may be larger than the minimum; extra melds after the base are sets or runs of 3+ only (never new pairs); you may never lay or build away your last card (the final discard ends the round); players advance a step at round end only if they laid their base; the game ends when someone goes out on Step 15 with a strictly lowest score; wilds are fixed once laid; a 2 can be played as itself. Undo covers only `layBase`/`layMeld`/`build` (not draws: undo-and-redraw would let a player peek at the stock).
- **Drag and drop (`Hand.tsx`)** measures slot positions once when a drag starts and moves cards only with `transform`s; it listens on `window`, not the card. Never use CSS `zoom` or scale transforms to fit the screen (pixel maths would drift). Card size comes from one variable, `--card-w`; everything on a card is a multiple of `--u` (one hundredth of the card's width).
- **UI tests lean on class names and text:** `.center`, `.piles`, `.board`, `.opponent`, `.hand`, `.meld`, `.log`, `.status-pill`; the strings "Your turn — draw a card" and "Round N" must stay unique on screen; `role="status"` is used by exactly one element at a time (`getByRole('status')`), so don't add another.
- **Test helpers** (`tests/helpers.ts`): cards are tokens, `"5S"`, `"TH"`, `"X"` (joker); a second copy is `"5S.2"`. `scenario({...})` builds a game state directly (it does not keep the 108-card total). Property tests (fast-check) run with a **fresh random seed each time**: a rare failure is a real counterexample, so re-run with a larger `numRuns` to catch it, then add a regression test.
- Verify UI changes in a real browser, not only jsdom. Tests can't see layout, overlap, or whether something is findable: use headless Chrome through `puppeteer-core` (install it in a scratch folder, not in this repo) against `npm run dev`.

## Git workflow

- **Never push directly to `main` or `master`.** Always push to a feature branch first; the owner reviews and merges it themselves.
- Work in iterations and chunks, each on its own **feature branch** (e.g. `feature/sound`), created from an up-to-date `main`. Commit on the branch, push the branch, and stop there. Do not merge into `main`, and do not open or merge a PR unless asked.
- Run `npm run typecheck` and `npm test` before committing.
