import { createAI, type Difficulty } from '../src/ai/player';
import { runGame } from '../src/sim/run';

const levels: Difficulty[] = ['easy', 'medium', 'hard'];
const games = Number(process.argv[2] ?? 20);
const wins: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
let finished = 0, rounds = 0, bestSteps = 0;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const order = levels.map((_, i) => levels[(i + g) % 3] as Difficulty);
  const res = runGame(
    { playerNames: order.map((l, i) => `${l}${i}`), seed: 1000 + g },
    order.map((l, i) => createAI(l, g * 10 + i)),
    { maxRounds: 150 },
  );
  rounds += res.rounds;
  bestSteps += Math.max(...res.state.players.map((p) => p.step));
  if (res.finished) { finished++; wins[order[res.state.winner as number] as string]!++; }
}
console.log({ games, finished, avgRounds: rounds / games, avgBestStep: bestSteps / games, wins, seconds: (Date.now() - t0) / 1000 });
