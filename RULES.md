# 15 Steps — Rules

A rummy-style card game for 2 to 6 players. Each player works through 15 steps, each requiring a different combination of sets and runs. The goal is to complete all 15 steps with the lowest penalty score.

## Contents

1. [Overview](#overview)
2. [The 15 Steps](#the-15-steps)
3. [Definitions](#definitions)
4. [Card Values and Scoring](#card-values-and-scoring)
5. [Setup](#setup)
6. [Playing a Round](#playing-a-round)
7. [Ending a Round](#ending-a-round)
8. [Winning the Game](#winning-the-game)
9. [Strategy Notes](#strategy-notes)
10. [Variants and Not Implemented](#variants-and-not-implemented)
11. [Open Questions](#open-questions)

## Overview

- **Decks:** Two standard 52-card decks shuffled together, including all four jokers (108 cards).
- **Players:** 2 to 4 is typical. 2 to 6 should work in theory, but 5 or 6 players has rarely or never been played.
- **Hand size:** 13 cards per player.
- **Goal:** Complete all 15 steps, finishing with the lowest score. Within a round, get rid of every card in your hand. When someone goes out, everyone else takes penalty points for the cards they are still holding.

## The 15 Steps

Every player starts on Step 1. To complete a step, you must lay down its **base** requirement.

| Step | Base Requirement |
|-----:|------------------|
| 1  | Two sets of three |
| 2  | One set of three and one run of three |
| 3  | One run of seven |
| 4  | Five pairs |
| 5  | Three sets of three |
| 6  | Two sets of three and one run of three |
| 7  | One set of four and one run of three |
| 8  | Two runs of four |
| 9  | Two runs of three and one set of three |
| 10 | Two sets of four |
| 11 | One set of three and one run of five |
| 12 | One set of three and one run of seven |
| 13 | One set of seven |
| 14 | One set of five and one run of three |
| 15 | One run of ten |

## Definitions

### Set

Any number of cards of the same rank (suit does not matter), e.g. three 7s is a "set of three" and four jacks is a "set of four". Sets may contain duplicate suits, since two decks are used (e.g. two 7 of hearts). There is **no maximum length**: with wilds, sets of 10, 12, 14 or more are fine.

### Run

A succession of consecutive ranks **all in the same suit**, e.g. 5-6-7, 8-9-10, Jack-Queen-King.

- Ace may be low (Ace-2-3) or high (Queen-King-Ace).
- Runs **cannot wrap around**: King-Ace-2 is not a run.

### Pair

Two cards of the same rank (suit does not matter). The five pairs in Step 4 can be any pairs, so two pairs of the same rank (e.g. two pairs of 9s) are allowed. **A set of four counts as two pairs** (e.g. four jacks, four 4s or four 2s).

### Meld

A set, run or pair laid face-up on the table.

- A meld must be **complete** (valid) when it is laid down. Partial melds are never placed on the table.
- The **minimum size of any set or run is three** cards.
- Melds are **permanent** once laid down. They cannot be changed or rearranged.

### Wild cards

- **Jokers and 2s are wild** and can stand in for any card in a set or run.
- There is **no limit** on the number of wilds in a meld. Three wilds on their own count as a set of three.
- A 2 may still be played as a natural 2 (e.g. Ace-2-3, or a set of three 2s). This is allowed but rare.
- Once a wild is laid down, the card it stands for is **fixed permanently**. In a run laid down as 5-wild-7, the wild is a 6 forever.
- You **cannot swap** a natural card for a wild in a laid-down meld.

## Card Values and Scoring

| Card | Points |
|------|-------:|
| Joker | 50 |
| 2 | 20 |
| Ace | 15 |
| 10, Jack, Queen, King | 10 |
| 3 through 9 | 5 |

- Points are **penalties** added to a player's score for each card still in their hand when another player goes out.
- Scores are **cumulative** across all rounds, and **lower is better**.
- Wilds count at full value if you are caught holding them (joker 50, 2 = 20).
- The player who goes out holds no cards, so takes no penalty that round.

## Setup

1. Choose a dealer by any means. There is no rule for this.
2. The player to the dealer's left cuts the deck.
3. The dealer deals 13 cards to each player.
4. The remaining cards form the face-down **stock**. The dealer turns up the top card to start the face-up **discard pile**.
5. The player to the dealer's left plays first. Play proceeds **clockwise**.

## Playing a Round

### On your turn

1. **Draw one card:** either the top card of the stock (face-down) or the top card of the discard pile (face-up). Only one card may be picked up, and only the top card of the discard pile may be taken.
2. **Lay down melds** if you are able to (see below).
3. **Discard one card** face-up onto the discard pile. This is mandatory at the end of every turn. The discard may be a wild.

### The base requirement

- Before laying down any other cards, you must lay down your current step's **base** requirement.
- After your base is down, you may lay down additional sets and runs (each at least 3 cards) and **build on** other melds.
- You may lay down your base **and** other melds **in the same turn**. You can even lay down your whole hand and go out in a single turn.
- If you cannot or do not lay down your base, you can only draw and discard.

### Building on melds

Once you have laid down your own base, you may add cards to any melds on the table, **yours or other players'**.

- Sets can be extended with any card of the same rank (or a wild).
- Runs can be extended at **either end**, with no limit on length, as far as the ace at the top and ace at the bottom allow. Runs can only be **extended** up or down, never duplicated. Example: a laid-down 5-wild-7 (wild = 6) can be extended with a 4, or an 8, or 8-9-10, and so on.
- You can build on **any** player's melds regardless of which step they or you are on, as long as the addition is valid (sets with sets, runs with runs, pairs with pairs). Example: a player on Step 1 can add to melds laid down by a player on Step 4.
- **Pairs** can be built on too. If a player lays down pairs of 2s, 7s and 5s, any player who has laid down their base can add another 5 or 7 to those. A pair with a card added becomes a set of three, and further cards make it a set of four, five, and so on.
- Example: a player lays down sets of 3s and 4s. Another player who has laid down their own base (say sets of 7s and 8s) can add 3s and 4s to those sets to shed cards.

### Going out

To go out, you must get rid of **every** card in your hand, **including your final discard**, so you need to plan ahead.

> **Example, Step 1:** You are dealt 13 cards and draw one, so you hold 14. Your two sets of three use 6 cards, leaving 8. You must lay off all but one of those 8 cards (as additional sets and runs, or by building on melds on the table), then discard the last one.

### Stock runs out

When the stock is empty, the top card of the discard pile stays where it is. The rest of the discard pile is shuffled to become the new stock.

## Ending a Round

- The round ends as soon as a player goes out.
- Every other player adds penalty points for the cards left in their hand.
- **Advancing:** A player who laid down their base this round advances to the next step on the next deal. A player who did not **repeats the same step** until they complete it.

## Winning the Game

- Step 15 is the final step. Nobody advances past it.
- A player finishes the game by **completing Step 15 (laying down its base) and going out** (getting rid of every card, including the final discard). The first player to do both ends the game, and scores are tabulated at that moment.
- When a round ends, every player who **completed Step 15 that round (laid its base)** has finished all 15 steps. Once someone has gone out on Step 15, penalties are added and **the finisher with the lowest score wins**. It does not matter which finisher went out: if two players both completed Step 15 and one goes out, the other takes penalties, and then the lower total wins.
- A player who did not complete Step 15 cannot win that round, whatever their score.
- **Ties:** If two or more finishers tie for the lowest score, the game continues: everyone repeats the step they were on (Step 15 for the finishers) until the tie is broken by a round in which one finisher is strictly lowest.
- If you go out on Step 15 and a player who also finished it has a lower score, **the game ends and they win**.

## Strategy Notes

- **When to lay down:** When you complete your base, you can lay it down right away, or **hold** it, hoping to catch opponents holding many cards when you go out. Laying down early reveals what you are collecting. Holding is risky, since someone else may go out first.
- **Reading opponents:** Work out what the other players are collecting and avoid discarding cards they need.
- **Dumping wilds:** If someone else is about to go out, it can be right to discard your jokers and 2s so you are not stuck holding 50 or 20 penalty points each.
- **Surprise out:** Laying down everything and going out in one turn is legal and powerful.

## Variants and Not Implemented

- **Dealer bonus (original rule, not implemented):** If the dealer, while dealing, grabs exactly the right number of cards for everyone, or one over or one under (e.g. 51, 52 or 53 for four players), they get a 50-point bonus off their score. This depends on physical cutting, so it is dropped from the digital version.
- **Swapping wilds (possible variant):** Allow a natural card to replace a wild in a laid-down meld.
- **Deep discard pickup (possible variant):** Allow taking cards from deeper in the discard pile. The original rule is uncertain, so the base game allows only the top card.

## Open Questions

None at this time.
