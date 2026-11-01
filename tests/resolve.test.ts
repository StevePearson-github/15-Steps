import { describe, expect, it } from 'vitest';
import { resolveMeld } from '../src/engine';
import { cards } from './helpers';

describe('resolving wilds automatically', () => {
  it('5-wild-7 is unambiguous: the wild is a 6', () => {
    const specs = resolveMeld('run', cards('7H X 5H'));
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ kind: 'run', suit: 'H', start: 5 });
    expect(specs[0]?.cardIds).toEqual(['5H.1', 'X.1', '7H.1']);
  });
  it('the order cards are given in does not matter', () => {
    expect(resolveMeld('run', cards('5H 7H 2S'))).toHaveLength(1);
    expect(resolveMeld('run', cards('7H 6H 5H'))).toHaveLength(1);
  });
  it('wilds at an end are ambiguous, and a hint settles it', () => {
    const open = resolveMeld('run', cards('5H 6H X'));
    expect(open.map((s) => s.kind === 'run' && s.start)).toEqual([4, 5]);
    const hinted = resolveMeld('run', cards('5H 6H X'), { start: 5 });
    expect(hinted).toHaveLength(1);
  });
  it('a run touching the ace has fewer readings', () => {
    expect(resolveMeld('run', cards('QS KS X'))).toHaveLength(2); // J-Q-K or Q-K-A
    expect(resolveMeld('run', cards('QS KS AS'))).toHaveLength(1);
    expect(resolveMeld('run', cards('AS 3S X'))).toHaveLength(1); // A-2-3
  });
  it('knows a 2 in its natural place; prefers that reading first', () => {
    const specs = resolveMeld('run', cards('2H 3H 4H'));
    expect(specs[0]).toMatchObject({ start: 2 });
    expect(specs.length).toBeGreaterThan(1);
  });
  it('reports invalid runs as no options', () => {
    expect(resolveMeld('run', cards('5H 6S 7H'))).toEqual([]);
    expect(resolveMeld('run', cards('5H 5H.2 7H'))).toEqual([]);
    // K-A-2 cannot wrap, but the wild 2 can stand in for the queen: Q-K-A.
    const kA2 = resolveMeld('run', cards('KS AS 2S'));
    expect(kA2).toHaveLength(1);
    expect(kA2[0]).toMatchObject({ start: 12 });
    expect(kA2[0]?.cardIds).toEqual(['2S.1', 'KS.1', 'AS.1']);
  });
  it('three wilds in a run need a suit', () => {
    const specs = resolveMeld('run', cards('X X.2 2S'));
    expect(new Set(specs.map((s) => s.kind === 'run' && s.suit)).size).toBe(4);
    expect(resolveMeld('run', cards('X X.2 2S'), { suit: 'D', start: 4 })).toHaveLength(1);
  });
  it('a set with a natural card needs no declaration', () => {
    const specs = resolveMeld('set', cards('7S X 2H'));
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ kind: 'set', rank: 7 });
  });
  it('three wilds in a set are ambiguous (a plain 2s reading comes first)', () => {
    const specs = resolveMeld('set', cards('X X.2 X.3'));
    expect(specs).toHaveLength(13);
    expect(resolveMeld('set', cards('X X.2 X.3'), { rank: 9 })).toHaveLength(1);
    expect(resolveMeld('set', cards('2S 2H X'))[0]).toMatchObject({ rank: 2 });
  });
  it('rejects sets with mixed ranks', () => {
    expect(resolveMeld('set', cards('7S 8S X'))).toEqual([]);
  });
  it('resolves pairs and enforces the size', () => {
    expect(resolveMeld('pair', cards('9S X'))).toHaveLength(1);
    expect(resolveMeld('pair', cards('9S 9H 9D'))).toEqual([]);
  });
});
