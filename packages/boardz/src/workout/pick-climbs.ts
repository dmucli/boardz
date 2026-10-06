import type { Climb } from '@boardsesh/shared-schema';
import type { GradePool } from './fetch-pools';

export type RandomSource = () => number;

/** A climb chosen for one slot of the plan, with the grade that slot asked for. */
export type PlannedClimb = { climb: Climb; grade: number };

/**
 * The unused climbs of the grade closest to `grade` that still has some: the
 * grade itself first, then one either side (easier first), and so on. Unsent
 * climbs at any grade come before the sent top-up.
 */
function nearestUnused(grade: number, pools: ReadonlyMap<number, GradePool>, used: ReadonlySet<string>): Climb[] {
  const byDistance = [...pools.keys()].sort(
    (first, second) => Math.abs(first - grade) - Math.abs(second - grade) || first - second,
  );
  for (const tier of ['preferred', 'extra'] as const) {
    for (const poolGrade of byDistance) {
      const unused = (pools.get(poolGrade)?.[tier] ?? []).filter((climb) => !used.has(climb.uuid));
      if (unused.length > 0) return unused;
    }
  }
  return [];
}

const pickOne = (climbs: readonly Climb[], random: RandomSource): Climb | undefined =>
  climbs[Math.floor(random() * climbs.length)];

/**
 * One distinct climb per planned grade, picked at random from that grade's
 * pool. A grade that has run out borrows from the nearest grade that hasn't;
 * a slot nothing is left for is dropped and counted in `missing`.
 */
export function pickClimbs(
  grades: readonly number[],
  pools: ReadonlyMap<number, GradePool>,
  random: RandomSource = Math.random,
): { planned: PlannedClimb[]; missing: number } {
  const used = new Set<string>();
  const planned: PlannedClimb[] = [];
  let missing = 0;
  for (const grade of grades) {
    const next = pickOne(nearestUnused(grade, pools, used), random);
    if (!next) {
      missing += 1;
      continue;
    }
    used.add(next.uuid);
    planned.push({ climb: next, grade });
  }
  return { planned, missing };
}

/** A different climb for slot `index`, as close to its grade as possible, never one already in the plan. */
export function swapClimb(
  planned: readonly PlannedClimb[],
  index: number,
  pools: ReadonlyMap<number, GradePool>,
  random: RandomSource = Math.random,
): PlannedClimb[] {
  const slot = planned[index];
  if (!slot) return [...planned];
  const used = new Set(planned.map((entry) => entry.climb.uuid));
  const replacement = pickOne(nearestUnused(slot.grade, pools, used), random);
  if (!replacement) return [...planned];
  return planned.map((entry, entryIndex) => (entryIndex === index ? { ...entry, climb: replacement } : entry));
}
