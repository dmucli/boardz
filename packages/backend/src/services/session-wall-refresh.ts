import { eq } from 'drizzle-orm';
import * as dbSchema from '@boardsesh/db/schema';
import type { SessionEvent } from '@boardsesh/shared-schema';
import { db } from '../db/client';
import { pubsub } from '../pubsub/index';
import { logger } from '../utils/logger';
import { tickMovedSessionWall, toBoardId } from './session-board';

type SessionBoardPathChanged = Extract<SessionEvent, { __typename?: 'SessionBoardPathChanged' }>;

/**
 * A live session's roster and queue name people according to the one wall the
 * session is on (`resolveSessionBoards`). When that wall changes, every
 * connected peer's `sessionUpdates` and `queueUpdates` re-project what they
 * already sent. The signal rides the session channel as `SessionBoardPathChanged`
 * with two server-only fields; GraphQL never serializes them, and an instance
 * that predates them treats the event as an ordinary path change.
 */
export type SessionBoardPathChangedMessage = SessionBoardPathChanged & {
  /** False for an angle-only change, which cannot move the wall. Missing reads as true. */
  wallChanged?: boolean;
  /**
   * The path did not change; only the wall did (a lit climb's binding or a newer
   * tick). Subscribers re-project identities and send no path event of their own.
   */
  pathUnchanged?: boolean;
};

/** Whether this session event means the session's wall may have moved. */
export function movesSessionWall(event: SessionEvent): boolean {
  return (
    event.__typename === 'SessionBoardPathChanged' && (event as SessionBoardPathChangedMessage).wallChanged !== false
  );
}

/** The client-facing part of a path event, without the server-only fields. */
export function clientPathEvent(event: SessionBoardPathChangedMessage): SessionBoardPathChanged {
  return {
    __typename: 'SessionBoardPathChanged',
    boardPath: event.boardPath,
    changedByParticipantId: event.changedByParticipantId ?? null,
  };
}

export function publishSessionBoardPathChanged(
  sessionId: string,
  boardPath: string,
  changedByParticipantId: string | null,
  wallChanged: boolean,
): void {
  const event: SessionBoardPathChangedMessage = {
    __typename: 'SessionBoardPathChanged',
    boardPath,
    changedByParticipantId,
    wallChanged,
  };
  pubsub.publishSessionEvent(sessionId, event);
}

/**
 * Tell a session's connected peers its wall moved without its path changing: a
 * lit climb bound it to another board, or a newer tick placed it. A session with
 * a primary board is placed by that board alone, so nothing else can move it.
 * Best-effort: a failed read leaves fresh reads correct, and the caller's write
 * has already committed.
 */
export async function publishSessionWallChanged(sessionId: string): Promise<void> {
  try {
    const [session] = await db
      .select({ boardId: dbSchema.boardSessions.boardId, boardPath: dbSchema.boardSessions.boardPath })
      .from(dbSchema.boardSessions)
      .where(eq(dbSchema.boardSessions.id, sessionId))
      .limit(1);
    if (!session || toBoardId(session.boardId)) return;
    const event: SessionBoardPathChangedMessage = {
      __typename: 'SessionBoardPathChanged',
      boardPath: session.boardPath ?? '',
      changedByParticipantId: null,
      wallChanged: true,
      pathUnchanged: true,
    };
    pubsub.publishSessionEvent(sessionId, event);
  } catch (error) {
    logger.warn(`[session-wall-refresh] wall refresh for ${sessionId} failed: ${String(error)}`);
  }
}

/**
 * `publishSessionWallChanged` for a tick just saved into a session, when that
 * tick moved the session's wall (the newest-tick rung). Best-effort, like it.
 */
export async function publishSessionWallChangedByTick(sessionId: string, tickUuid: string): Promise<void> {
  try {
    if (await tickMovedSessionWall(sessionId, tickUuid)) await publishSessionWallChanged(sessionId);
  } catch (error) {
    logger.warn(`[session-wall-refresh] tick wall check for ${sessionId} failed: ${String(error)}`);
  }
}
