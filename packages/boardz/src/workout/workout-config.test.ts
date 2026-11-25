import { describe, expect, it } from 'vitest';
import { getGradesForBoard } from '@boardsesh/board-config';
import { WORKOUTS } from './catalog';
import {
  defaultConfig,
  estimateMinutes,
  plannedGrades,
  usesField,
  warmUpGrades,
  workoutTiming,
  workoutTitle,
} from './workout-config';

const moonboardGrades = getGradesForBoard('moonboard');
// What a MoonBoard at 40° has workout climbs at: 6A+ (17) and up.
const moonboardAt40 = moonboardGrades.filter((grade) => grade.difficulty_id >= 17);
const SIX_B = 18;
const SEVEN_A = 22;

describe('plannedGrades', () => {
  it('builds a pyramid up to the peak and back down', () => {
    const config = { ...defaultConfig('pyramid', SIX_B), warmUp: false };
    expect(plannedGrades(config, moonboardGrades)).toEqual([16, 17, 18, 17, 16]);
  });

  it('builds a warm-up from the grades below the target and nothing else', () => {
    const grades = plannedGrades(defaultConfig('warmUp', SIX_B), moonboardGrades);
    // Moon's scale skips 5b and 5c (14, 15), so 5+ (13) takes two climbs.
    expect(grades).toEqual([13, 13, 16, 17]);
  });

  it('puts every on-the-minute and limit climb at the working grade', () => {
    expect(plannedGrades({ ...defaultConfig('onTheMinute', SIX_B), climbs: 3 }, moonboardGrades)).toEqual([18, 18, 18]);
    expect(plannedGrades(defaultConfig('limitBouldering', 24), moonboardGrades)).toEqual([24, 24, 24]);
  });

  it('picks four climbs for a 4x4, whatever the round count', () => {
    expect(plannedGrades({ ...defaultConfig('fourByFour', SIX_B), rounds: 6 }, moonboardGrades)).toHaveLength(4);
  });

  it('adds the warm-up in front of the main set when asked', () => {
    const grades = plannedGrades({ ...defaultConfig('gradeFocus', SIX_B), climbs: 2, warmUp: true }, moonboardGrades);
    expect(grades).toEqual([13, 13, 16, 17, 18, 18]);
  });

  it('keeps a pyramid on grades the board has climbs at', () => {
    const config = { ...defaultConfig('pyramid', SIX_B), warmUp: false };
    expect(plannedGrades(config, moonboardAt40)).toEqual([17, 17, 18, 17, 17]);
  });

  it('plans nothing for free climbing', () => {
    expect(plannedGrades(defaultConfig('freeClimbing', SIX_B), moonboardGrades)).toEqual([]);
  });
});

describe('warmUpGrades', () => {
  it('always gives a short warm-up 4 climbs and a long one 12', () => {
    for (const target of [17, SIX_B, SEVEN_A, 30]) {
      expect(warmUpGrades(target, moonboardAt40, 'standard')).toHaveLength(4);
      expect(warmUpGrades(target, moonboardAt40, 'extended')).toHaveLength(12);
    }
  });

  it('steps up one grade per climb when the board has the grades', () => {
    expect(warmUpGrades(SEVEN_A, moonboardAt40, 'standard')).toEqual([18, 19, 20, 21]);
  });

  it('gives the easier grades the extra climbs when there are fewer grades than climbs', () => {
    expect(warmUpGrades(SEVEN_A, moonboardAt40, 'extended')).toEqual([17, 17, 17, 18, 18, 18, 19, 19, 20, 20, 21, 21]);
    expect(warmUpGrades(SIX_B, moonboardAt40, 'standard')).toEqual([17, 17, 17, 17]);
  });

  it('warms up at the target when nothing on the board is easier', () => {
    expect(warmUpGrades(17, moonboardAt40, 'standard')).toEqual([17, 17, 17, 17]);
  });
});

describe('workoutTiming', () => {
  it('matches each workout to how it is paced', () => {
    expect(workoutTiming(defaultConfig('pyramid', SIX_B))).toEqual({ kind: 'rest', restSeconds: 120 });
    expect(workoutTiming(defaultConfig('onTheMinute', SIX_B))).toEqual({ kind: 'interval', intervalSeconds: 60 });
    expect(workoutTiming(defaultConfig('fourByFour', SIX_B))).toEqual({
      kind: 'rounds',
      rounds: 4,
      restBetweenClimbsSeconds: 0,
      restBetweenRoundsSeconds: 240,
    });
    expect(workoutTiming(defaultConfig('limitBouldering', SIX_B))).toEqual({ kind: 'limit', restSeconds: 180 });
    expect(workoutTiming(defaultConfig('freeClimbing', SIX_B))).toBeNull();
  });
});

describe('workout setup', () => {
  it('gives every workout in the catalogue a title and at least one setting', () => {
    for (const workout of WORKOUTS) {
      expect(workoutTitle(defaultConfig(workout.kind, SIX_B), '6B')).not.toBe('');
      expect(
        ['climbs', 'steps', 'warmUpLength', 'rounds', 'goalMinutes'].some((field) =>
          usesField(workout.kind, field as Parameters<typeof usesField>[1]),
        ),
      ).toBe(true);
    }
  });

  it('lets every workout that picks climbs limit them to benchmarks and unsent climbs', () => {
    for (const workout of WORKOUTS) {
      const picksClimbs = workout.kind !== 'freeClimbing';
      expect(usesField(workout.kind, 'benchmarksOnly')).toBe(picksClimbs);
      expect(usesField(workout.kind, 'freshClimbsOnly')).toBe(picksClimbs);
    }
  });

  it('estimates duration in five-minute steps', () => {
    expect(estimateMinutes({ ...defaultConfig('onTheMinute', SIX_B), climbs: 10 }, 10)).toBe(10);
    // Four rounds of about 3 minutes, with three 4-minute rests between them.
    expect(estimateMinutes(defaultConfig('fourByFour', SIX_B), 4)).toBe(25);
    expect(estimateMinutes(defaultConfig('freeClimbing', SIX_B), 0)).toBe(60);
  });
});
