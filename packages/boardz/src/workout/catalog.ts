/**
 * The workouts Boardz offers. Each `kind` is spelled like the block `type` in
 * Boardsesh's partner workout API (docs/partner-api.md), so a workout written
 * for that API maps onto these one to one.
 */
export type WorkoutKind =
  | 'warmUp'
  | 'pyramid'
  | 'ladder'
  | 'volume'
  | 'gradeFocus'
  | 'onTheMinute'
  | 'fourByFour'
  | 'limitBouldering'
  | 'freeClimbing';

/**
 * How a workout chooses climbs and paces itself.
 * - `generator`: @boardsesh/playlist-generator plans a grade for each climb.
 *   The warm-up uses the generator's `warmUp` option rather than a workout type.
 * - `timed`: a set of climbs run against a clock (intervals, rounds, rests).
 * - `free`: a timer only; the climber picks the climbs.
 */
export type WorkoutEngine = 'generator' | 'timed' | 'free';

export type WorkoutDefinition = {
  kind: WorkoutKind;
  name: string;
  engine: WorkoutEngine;
};

export const WORKOUTS: readonly WorkoutDefinition[] = [
  {
    kind: 'warmUp',
    name: 'Warm-up',
    engine: 'generator',
  },
  {
    kind: 'pyramid',
    name: 'Pyramid',
    engine: 'generator',
  },
  {
    kind: 'ladder',
    name: 'Ladder',
    engine: 'generator',
  },
  {
    kind: 'volume',
    name: 'Volume',
    engine: 'generator',
  },
  {
    kind: 'gradeFocus',
    name: 'Grade focus',
    engine: 'generator',
  },
  {
    kind: 'onTheMinute',
    name: 'On the minute',
    engine: 'timed',
  },
  {
    kind: 'fourByFour',
    name: '4x4',
    engine: 'timed',
  },
  {
    kind: 'limitBouldering',
    name: 'Limit bouldering',
    engine: 'timed',
  },
  {
    kind: 'freeClimbing',
    name: 'Free climbing',
    engine: 'free',
  },
];
