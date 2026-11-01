export type RequirementKind = 'set' | 'run' | 'pair';

export interface Requirement {
  kind: RequirementKind;
  /** Minimum number of cards in the meld that satisfies this requirement. */
  size: number;
}

const set = (size: number): Requirement => ({ kind: 'set', size });
const run = (size: number): Requirement => ({ kind: 'run', size });
const pair = (): Requirement => ({ kind: 'pair', size: 2 });

export const FINAL_STEP = 15;

/** Base requirements for each step. STEPS[0] is Step 1. */
export const STEPS: readonly (readonly Requirement[])[] = [
  [set(3), set(3)], // 1
  [set(3), run(3)], // 2
  [run(7)], // 3
  [pair(), pair(), pair(), pair(), pair()], // 4
  [set(3), set(3), set(3)], // 5
  [set(3), set(3), run(3)], // 6
  [set(4), run(3)], // 7
  [run(4), run(4)], // 8
  [run(3), run(3), set(3)], // 9
  [set(4), set(4)], // 10
  [set(3), run(5)], // 11
  [set(3), run(7)], // 12
  [set(7)], // 13
  [set(5), run(3)], // 14
  [run(10)], // 15
];

export function stepRequirements(step: number): readonly Requirement[] {
  const reqs = STEPS[step - 1];
  if (!reqs) throw new Error(`Invalid step ${step}`);
  return reqs;
}
