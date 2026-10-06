import { describe, expect, it } from 'vitest';
import type { Climb } from '@boardsesh/shared-schema';
import type { GradePool } from './fetch-pools';
import { pickClimbs, swapClimb } from './pick-climbs';

function climb(uuid: string): Climb {
  return {
    uuid,
    setter_username: 'setter',
    name: uuid,
    frames: 'p1r42',
    angle: 40,
    ascensionist_count: 100,
    difficulty: '6b/V4',
    quality_average: '4.0',
    stars: 3,
    difficulty_error: '0',
    benchmark_difficulty: null,
  };
}

const pool = (preferred: string[], extra: string[] = []): GradePool => ({
  preferred: preferred.map(climb),
  extra: extra.map(climb),
});

// Always the first candidate, so picks are predictable.
const first = () => 0;
const uuids = (planned: { climb: Climb }[]) => planned.map((entry) => entry.climb.uuid);

describe('pickClimbs', () => {
  const pools = new Map([
    [16, pool(['a', 'b'])],
    [18, pool(['c', 'd', 'e'])],
  ]);

  it('takes a different climb for each slot of the same grade', () => {
    const { planned, missing } = pickClimbs([16, 18, 18, 16], pools, first);
    expect(uuids(planned)).toEqual(['a', 'c', 'd', 'b']);
    expect(missing).toBe(0);
  });

  it('borrows from the nearest grade when one runs out, instead of dropping the climb', () => {
    const { planned, missing } = pickClimbs([16, 16, 16, 20], pools, first);
    expect(uuids(planned)).toEqual(['a', 'b', 'c', 'd']);
    expect(planned.map((entry) => entry.grade)).toEqual([16, 16, 16, 20]);
    expect(missing).toBe(0);
  });

  it('borrows from the easier grade when two are equally near', () => {
    const { planned } = pickClimbs([17], pools, first);
    expect(uuids(planned)).toEqual(['a']);
  });

  it('drops a slot only when every grade has run out', () => {
    const { planned, missing } = pickClimbs([16, 16, 16, 16, 16, 16], pools, first);
    expect(planned).toHaveLength(5);
    expect(missing).toBe(1);
  });

  it('uses unsent climbs at any grade before sent ones', () => {
    const withSent = new Map([
      [16, pool(['a'], ['sent-16'])],
      [18, pool(['c'])],
    ]);
    expect(uuids(pickClimbs([16, 16, 16], withSent, first).planned)).toEqual(['a', 'c', 'sent-16']);
  });

  it('picks at random within a grade', () => {
    const { planned } = pickClimbs([18], pools, () => 0.99);
    expect(uuids(planned)).toEqual(['e']);
  });
});

describe('swapClimb', () => {
  const pools = new Map([
    [16, pool(['a', 'b'])],
    [18, pool(['c', 'd', 'e'])],
  ]);

  it('swaps in a climb at the same grade that is not already planned', () => {
    const { planned } = pickClimbs([18, 18], pools, first);
    const swapped = swapClimb(planned, 0, pools, first);
    expect(uuids(swapped)).toEqual(['e', 'd']);
    expect(swapped[0].grade).toBe(18);
  });

  it('borrows from the nearest grade when its own has nothing left', () => {
    const { planned } = pickClimbs([16, 16], pools, first);
    expect(uuids(swapClimb(planned, 1, pools, first))).toEqual(['a', 'c']);
  });

  it('keeps the plan when there is nothing left anywhere', () => {
    const small = new Map([[16, pool(['a', 'b'])]]);
    const { planned } = pickClimbs([16, 16], small, first);
    expect(uuids(swapClimb(planned, 1, small))).toEqual(['a', 'b']);
  });
});
