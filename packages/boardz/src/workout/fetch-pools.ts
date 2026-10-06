import type { Climb, ClimbSearchInput } from '@boardsesh/shared-schema';
import { SEARCH_CLIMBS, type ClimbSearchResponse } from '@boardsesh/graphql/operations/climb-search';
import { graphqlRequest } from '../api/graphql-client';
import { toSearchConfig, type ActiveBoard } from '../board/active-board';
import { difficultyIdFromGrade } from '../grades/grades';

// Workouts only use well-tried, well-liked climbs: more than 50 ascents at this
// angle and rated above 3.5 stars. Ratings are 1–5 on every board and come with
// two decimals, so "at least 3.51" is "above 3.5".
const MIN_ASCENTS = 51;
const MIN_RATING = 3.51;
// Enough variety to shuffle and swap from, at one search per grade.
const POOL_SIZE = 50;

export type PoolFilters = {
  benchmarksOnly: boolean;
  /** Sent climbs go after unsent ones. Needs sign-in. */
  unsentFirst: boolean;
};

type RangeFilters = Pick<PoolFilters, 'benchmarksOnly'>;

/**
 * One grade's climbs, best rated first. With `unsentFirst`, `preferred` holds
 * the unsent climbs and `extra` tops the grade up with sent ones.
 */
export type GradePool = { preferred: Climb[]; extra: Climb[] };

function workoutSearch(board: ActiveBoard, filters: RangeFilters): ClimbSearchInput {
  return {
    ...toSearchConfig(board),
    page: 0,
    boulders: true,
    minAscents: MIN_ASCENTS,
    minRating: MIN_RATING,
    ...(filters.benchmarksOnly ? { onlyBenchmarks: true } : {}),
  };
}

async function search(input: ClimbSearchInput): Promise<Climb[]> {
  return (await graphqlRequest<ClimbSearchResponse>(SEARCH_CLIMBS, { input })).searchClimbs.climbs;
}

async function gradeEnd(board: ActiveBoard, filters: RangeFilters, sortOrder: 'asc' | 'desc'): Promise<number | null> {
  const [climb] = await search({ ...workoutSearch(board, filters), pageSize: 1, sortBy: 'difficulty', sortOrder });
  return climb ? difficultyIdFromGrade(climb.difficulty) : null;
}

/**
 * The easiest and hardest grades that have workout climbs on this board, so a
 * plan never asks for a grade with nothing on it. A MoonBoard at 40°, for one,
 * has no climbs below 6A+. Null when nothing qualifies.
 */
export async function fetchGradeRange(
  board: ActiveBoard,
  filters: RangeFilters,
): Promise<{ lowest: number; highest: number } | null> {
  const [lowest, highest] = await Promise.all([gradeEnd(board, filters, 'asc'), gradeEnd(board, filters, 'desc')]);
  return lowest === null || highest === null ? null : { lowest, highest };
}

/** The best-rated workout climbs at one grade. */
export async function fetchGradePool(board: ActiveBoard, grade: number, filters: PoolFilters): Promise<GradePool> {
  const input: ClimbSearchInput = {
    ...workoutSearch(board, filters),
    minGrade: grade,
    maxGrade: grade,
    pageSize: POOL_SIZE,
    sortBy: 'quality',
    sortOrder: 'desc',
  };
  if (!filters.unsentFirst) return { preferred: await search(input), extra: [] };
  const unsent = await search({ ...input, hideCompleted: true });
  // A full page of unsent climbs is more than any workout needs at one grade.
  if (unsent.length >= POOL_SIZE) return { preferred: unsent, extra: [] };
  const seen = new Set(unsent.map((climb) => climb.uuid));
  return { preferred: unsent, extra: (await search(input)).filter((climb) => !seen.has(climb.uuid)) };
}
