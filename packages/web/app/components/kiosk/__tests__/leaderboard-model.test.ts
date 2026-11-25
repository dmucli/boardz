import { describe, expect, it } from 'vitest';
import type { BoardLeaderboard, BoardLeaderboardEntry, BoardPresenceClimb } from '@boardsesh/shared-schema';
import {
  buildSessionLeaderboardRows,
  mergePeriodLeaderboards,
  mergeSettledPeriodLeaderboards,
} from '../leaderboard-rail/leaderboard-model';

const NOW = new Date('2026-07-15T19:00:00.000Z');

let nextSeq = 1;
function makeClimb(overrides: Partial<BoardPresenceClimb> & { climbUuid: string }): BoardPresenceClimb {
  return {
    sentAt: '2026-07-15T18:30:00.000Z',
    seq: nextSeq++,
    sentByUserId: null,
    sentByDisplayName: null,
    sentByAvatarUrl: null,
    ...overrides,
  };
}

describe('buildSessionLeaderboardRows', () => {
  it('merges histories across boards and sums distinct sends per climber', () => {
    const boardOneHistory = [
      makeClimb({ climbUuid: 'climb-a', sentByUserId: 'user-1', sentByDisplayName: 'Ada' }),
      makeClimb({ climbUuid: 'climb-b', sentByUserId: 'user-1', sentByDisplayName: 'Ada' }),
      makeClimb({ climbUuid: 'climb-c', sentByUserId: 'user-2', sentByDisplayName: 'Ben' }),
    ];
    const boardTwoHistory = [makeClimb({ climbUuid: 'climb-d', sentByUserId: 'user-1', sentByDisplayName: 'Ada' })];

    const rows = buildSessionLeaderboardRows([boardOneHistory, boardTwoHistory], {
      windowMinutes: 180,
      now: NOW,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 'user:user-1', displayName: 'Ada', sendCount: 3 });
    expect(rows[1]).toMatchObject({ key: 'user:user-2', displayName: 'Ben', sendCount: 1 });
  });

  it('drops sends outside the rolling window', () => {
    const history = [
      makeClimb({
        climbUuid: 'climb-old',
        sentByUserId: 'user-1',
        sentByDisplayName: 'Ada',
        sentAt: '2026-07-15T14:00:00.000Z', // 5h before NOW — outside a 180-min window
      }),
      makeClimb({ climbUuid: 'climb-new', sentByUserId: 'user-2', sentByDisplayName: 'Ben' }),
    ];

    const rows = buildSessionLeaderboardRows([history], { windowMinutes: 180, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('user:user-2');
  });

  it('keeps anonymous-but-named senders with a name-scoped key and null displayName only when truly anonymous', () => {
    const history = [
      makeClimb({ climbUuid: 'climb-a', sentByDisplayName: 'Guest Climber' }),
      // Fully anonymous send (no user id, no name) never ranks.
      makeClimb({ climbUuid: 'climb-b' }),
    ];

    const rows = buildSessionLeaderboardRows([history], { windowMinutes: 180, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'name:Guest Climber', displayName: 'Guest Climber', sendCount: 1 });
  });

  it('caps the ranking at 10 rows', () => {
    const history = Array.from({ length: 14 }, (_, index) =>
      makeClimb({
        climbUuid: `climb-${index}`,
        sentByUserId: `user-${index}`,
        sentByDisplayName: `Climber ${index}`,
      }),
    );

    const rows = buildSessionLeaderboardRows([history], { windowMinutes: 180, now: NOW });
    expect(rows).toHaveLength(10);
  });
});

function makeEntry(overrides: Partial<BoardLeaderboardEntry> & { userId: string | null }): BoardLeaderboardEntry {
  return {
    rank: 1,
    totalSends: 1,
    totalFlashes: 0,
    totalSessions: 1,
    ...overrides,
  };
}

function makeLeaderboard(boardUuid: string, entries: BoardLeaderboardEntry[]): BoardLeaderboard {
  return { boardUuid, entries, totalCount: entries.length, hasMore: false, periodLabel: 'This Week' };
}

describe('mergePeriodLeaderboards', () => {
  it('keeps hardest grade in single-board scope', () => {
    const rows = mergePeriodLeaderboards([
      makeLeaderboard('board-a', [
        makeEntry({ userId: 'user-1', userDisplayName: 'Ada', totalSends: 5, hardestGradeName: 'V8' }),
      ]),
    ]);
    expect(rows[0]).toMatchObject({ key: 'user:user-1', sendCount: 5, hardestGradeName: 'V8' });
  });

  it('merges multi-board results by user, summing sends and dropping hardest grade', () => {
    const rows = mergePeriodLeaderboards([
      makeLeaderboard('board-a', [
        makeEntry({ userId: 'user-1', userDisplayName: 'Ada', totalSends: 5, hardestGradeName: 'V8' }),
        makeEntry({ userId: 'user-2', userDisplayName: 'Ben', totalSends: 2, hardestGradeName: 'V4' }),
      ]),
      makeLeaderboard('board-b', [
        makeEntry({ userId: 'user-2', userDisplayName: 'Ben', totalSends: 6, hardestGradeName: 'V6' }),
      ]),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 'user:user-2', sendCount: 8, hardestGradeName: null });
    expect(rows[1]).toMatchObject({ key: 'user:user-1', sendCount: 5, hardestGradeName: null });
  });

  it('folds anonymous climbers into one unnamed row instead of a list of pseudonyms', () => {
    // The backend sends a private climber, or one who stays anonymous on boards
    // they don't own, with no user id or name. Totals still count them.
    const rows = mergePeriodLeaderboards([
      makeLeaderboard('board-a', [
        makeEntry({ userId: 'user-1', userDisplayName: 'Ada', totalSends: 3 }),
        makeEntry({ userId: null, totalSends: 4 }),
        makeEntry({ userId: null, totalSends: 2 }),
      ]),
      makeLeaderboard('board-b', [makeEntry({ userId: null, totalSends: 1 })]),
    ]);
    expect(rows).toEqual([
      { key: 'private-climbers', displayName: null, avatarUrl: null, sendCount: 7, hardestGradeName: null },
      { key: 'user:user-1', displayName: 'Ada', avatarUrl: null, sendCount: 3, hardestGradeName: null },
    ]);
  });

  it('fills missing display name/avatar from a later board entry', () => {
    const rows = mergePeriodLeaderboards([
      makeLeaderboard('board-a', [makeEntry({ userId: 'user-1', totalSends: 1 })]),
      makeLeaderboard('board-b', [
        makeEntry({ userId: 'user-1', userDisplayName: 'Ada', userAvatarUrl: 'https://example.com/a.png' }),
      ]),
    ]);
    expect(rows[0]).toMatchObject({ displayName: 'Ada', avatarUrl: 'https://example.com/a.png', sendCount: 2 });
  });

  it('caps merged rows at 10 and sorts deterministically on ties', () => {
    const manyEntries = Array.from({ length: 12 }, (_, index) =>
      makeEntry({ userId: `user-${String(index).padStart(2, '0')}`, totalSends: 3 }),
    );
    const rows = mergePeriodLeaderboards([makeLeaderboard('board-a', manyEntries)]);
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.key)).toEqual(rows.map((row) => row.key).sort());
  });
});

function fulfilled(leaderboard: BoardLeaderboard): PromiseFulfilledResult<{ boardLeaderboard: BoardLeaderboard }> {
  return { status: 'fulfilled', value: { boardLeaderboard: leaderboard } };
}

function rejected(): PromiseRejectedResult {
  return { status: 'rejected', reason: new Error('board fetch failed') };
}

describe('mergeSettledPeriodLeaderboards', () => {
  it('throws when EVERY board fetch failed (rail shows unavailable, not fake-empty)', () => {
    expect(() => mergeSettledPeriodLeaderboards([rejected(), rejected()])).toThrow(/all board fetches failed/);
  });

  it('narrows to the boards that answered on partial failure', () => {
    const rows = mergeSettledPeriodLeaderboards([
      fulfilled(makeLeaderboard('board-a', [makeEntry({ userId: 'user-1', totalSends: 4 })])),
      rejected(),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'user:user-1', sendCount: 4 });
  });

  it('treats zero scoped boards as an empty ranking, not an error', () => {
    expect(mergeSettledPeriodLeaderboards([])).toEqual([]);
  });

  it('still merges across boards when all succeed', () => {
    const rows = mergeSettledPeriodLeaderboards([
      fulfilled(makeLeaderboard('board-a', [makeEntry({ userId: 'user-1', totalSends: 2 })])),
      fulfilled(makeLeaderboard('board-b', [makeEntry({ userId: 'user-1', totalSends: 3 })])),
    ]);
    expect(rows[0]).toMatchObject({ key: 'user:user-1', sendCount: 5, hardestGradeName: null });
  });
});
