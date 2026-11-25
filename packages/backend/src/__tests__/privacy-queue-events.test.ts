import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { ClimbQueueItem, QueueEvent } from '@boardsesh/shared-schema';
vi.hoisted(() => vi.resetModules());
const projection = vi.hoisted(() => ({
  redactQueueItem: vi.fn(async (item: ClimbQueueItem) => ({
    ...item,
    addedBy: undefined,
    addedByUser: undefined,
    tickedBy: [],
    climb: { ...item.climb, name: '', frames: '', setter_username: '' },
  })),
  queueItemUserIds: vi.fn((items: ClimbQueueItem[]) =>
    items.flatMap((item) => [item.addedBy, ...(item.tickedBy ?? [])]),
  ),
  sessionVisibleUserIds: vi.fn(async () => new Set<string>(['public-user'])),
}));
vi.mock('../services/board-session-privacy', () => projection);
const { redactQueueEvent, redactQueueEvents } = await import('../services/privacy-queue-events');

const item: ClimbQueueItem = {
  uuid: 'queue-1',
  addedBy: 'private-user',
  addedByUser: { id: 'private-user', username: 'Private name' },
  tickedBy: ['private-user'],
  climb: {
    uuid: 'private-climb',
    name: 'Private name',
    frames: 'private-holds',
    setter_username: 'Private setter',
    angle: 40,
    ascensionist_count: 1,
    difficulty: 'V4',
    quality_average: '3',
    stars: 3,
    difficulty_error: '0',
    benchmark_difficulty: null,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('queue replay projection', () => {
  it('redacts buffered additions exactly like live additions while preserving sequence and hashes', async () => {
    const event: QueueEvent = { __typename: 'QueueItemAdded', sequence: 42, stateHash: 'same-hash', item };
    const projected = await redactQueueEvent(event, 'viewer', 'session-1');
    expect(projected).toMatchObject({
      sequence: 42,
      stateHash: 'same-hash',
      item: { addedBy: undefined, tickedBy: [], climb: { uuid: 'private-climb', name: '', frames: '' } },
    });
    expect(projection.redactQueueItem).toHaveBeenCalledWith(item, 'viewer', 'session-1', undefined);
    expect(event.item.addedBy).toBe('private-user');
  });
  it('projects full snapshots and removes unattributed frame payloads', async () => {
    const full = await redactQueueEvent(
      {
        __typename: 'FullSync',
        sequence: 42,
        state: { sequence: 42, stateHash: 'same-hash', queue: [item], currentClimbQueueItem: item },
      },
      'viewer',
      'session-1',
    );
    expect(full).toMatchObject({
      state: { queue: [{ addedBy: undefined }], currentClimbQueueItem: { addedBy: undefined } },
    });
    // One lookup covers every climber in the snapshot, then each item reuses it.
    expect(projection.sessionVisibleUserIds).toHaveBeenCalledTimes(1);
    expect(projection.queueItemUserIds).toHaveBeenCalledWith([item, item]);
    expect(projection.sessionVisibleUserIds).toHaveBeenCalledWith(
      ['private-user', 'private-user', 'private-user', 'private-user'],
      'viewer',
      'session-1',
    );
    expect(projection.redactQueueItem).toHaveBeenCalledWith(item, 'viewer', 'session-1', new Set(['public-user']));
    expect(
      await redactQueueEvent(
        {
          __typename: 'CurrentClimbChanged',
          sequence: 43,
          stateHash: 'hash',
          item: null,
          frames: 'unattributed-holds',
          clientId: null,
          correlationId: null,
        },
        'viewer',
        'session-1',
      ),
    ).toMatchObject({ sequence: 43, frames: null });
  });
  it('names every climber in a replayed run of events with one lookup', async () => {
    const added = (uuid: string, addedBy: string): QueueEvent => ({
      __typename: 'QueueItemAdded',
      sequence: 1,
      stateHash: 'hash',
      item: { ...item, uuid, addedBy, addedByUser: { id: addedBy, username: addedBy }, tickedBy: [] },
    });
    const replayed = await redactQueueEvents(
      [added('queue-a', 'public-user'), added('queue-b', 'other-user')],
      'viewer',
      'session-1',
    );
    expect(replayed).toHaveLength(2);
    expect(projection.sessionVisibleUserIds).toHaveBeenCalledTimes(1);
    expect(projection.sessionVisibleUserIds).toHaveBeenCalledWith(['public-user', 'other-user'], 'viewer', 'session-1');
    for (const nth of [1, 2])
      expect(projection.redactQueueItem).toHaveBeenNthCalledWith(
        nth,
        expect.anything(),
        'viewer',
        'session-1',
        new Set(['public-user']),
      );
  });
});
