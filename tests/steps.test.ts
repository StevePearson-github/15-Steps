import { describe, expect, it } from 'vitest';
import { STEPS } from '../src/engine';

const text = (step: number) =>
  (STEPS[step - 1] ?? []).map((r) => `${r.kind}${r.size}`).join(' ');

describe('the 15 steps', () => {
  it('has 15 steps', () => expect(STEPS).toHaveLength(15));
  it.each([
    [1, 'set3 set3'],
    [2, 'set3 run3'],
    [3, 'run7'],
    [4, 'pair2 pair2 pair2 pair2 pair2'],
    [5, 'set3 set3 set3'],
    [6, 'set3 set3 run3'],
    [7, 'set4 run3'],
    [8, 'run4 run4'],
    [9, 'run3 run3 set3'],
    [10, 'set4 set4'],
    [11, 'set3 run5'],
    [12, 'set3 run7'],
    [13, 'set7'],
    [14, 'set5 run3'],
    [15, 'run10'],
  ])('step %i is %s', (step, expected) => {
    expect(text(step)).toBe(expected);
  });
});
