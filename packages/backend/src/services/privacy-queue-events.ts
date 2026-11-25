import type { ClimbQueueItem, QueueEvent, QueueState } from '@boardsesh/shared-schema';
import { queueItemUserIds, redactQueueItem, sessionVisibleUserIds } from './board-session-privacy';

const stateItems = (state: QueueState): ClimbQueueItem[] =>
  state.currentClimbQueueItem ? [...state.queue, state.currentClimbQueueItem] : state.queue;

/**
 * `sessionId` is the session the queue belongs to; its board decides who stays
 * anonymous. Pass `visibleUserIds` when it is already known for these items.
 */
export async function redactQueueState(
  state: QueueState,
  viewerId: string | null | undefined,
  sessionId: string | null | undefined,
  visibleUserIds?: ReadonlySet<string>,
): Promise<QueueState> {
  // One lookup names (or not) every climber in the snapshot.
  const visible =
    visibleUserIds ?? (await sessionVisibleUserIds(queueItemUserIds(stateItems(state)), viewerId, sessionId));
  return {
    ...state,
    queue: await Promise.all(state.queue.map((item) => redactQueueItem(item, viewerId, sessionId, visible))),
    currentClimbQueueItem: state.currentClimbQueueItem
      ? await redactQueueItem(state.currentClimbQueueItem, viewerId, sessionId, visible)
      : null,
  };
}

/** Every queue item an event carries. */
function eventItems(event: QueueEvent): ClimbQueueItem[] {
  switch (event.__typename) {
    case 'FullSync':
      return stateItems(event.state);
    case 'QueueItemAdded':
      return [event.item];
    case 'CurrentClimbChanged':
      return event.item ? [event.item] : [];
    default:
      return [];
  }
}

/** Live deltas and persisted replay always use the same viewer projection. */
export async function redactQueueEvent(
  event: QueueEvent,
  viewerId: string | null | undefined,
  sessionId: string | null | undefined,
  visibleUserIds?: ReadonlySet<string>,
): Promise<QueueEvent> {
  switch (event.__typename) {
    case 'FullSync':
      return { ...event, state: await redactQueueState(event.state, viewerId, sessionId, visibleUserIds) };
    case 'QueueItemAdded':
      return { ...event, item: await redactQueueItem(event.item, viewerId, sessionId, visibleUserIds) };
    case 'CurrentClimbChanged':
      return {
        ...event,
        item: event.item ? await redactQueueItem(event.item, viewerId, sessionId, visibleUserIds) : null,
        frames: null,
      };
    default:
      return event;
  }
}

/** `redactQueueEvent` for a replayed run of events: one lookup names every climber in all of them. */
export async function redactQueueEvents(
  events: readonly QueueEvent[],
  viewerId: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<QueueEvent[]> {
  const visible = await sessionVisibleUserIds(queueItemUserIds(events.flatMap(eventItems)), viewerId, sessionId);
  return Promise.all(events.map((event) => redactQueueEvent(event, viewerId, sessionId, visible)));
}
