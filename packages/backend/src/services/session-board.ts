import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray } from 'drizzle-orm';
import { normaliseSetIds, parseBoardPath, parseNamedBoardPath } from '@boardsesh/board-config';
import * as dbSchema from '@boardsesh/db/schema';
import { db } from '../db/client';
import { pubsub } from '../pubsub/index';
import { logger } from '../utils/logger';

/**
 * The one board a live session is on, for every surface that shows it: the
 * Climbing now card, and the roster, queue, host, Live Activity, nearby
 * discovery and session detail of the session that card opens. A climber who
 * stays anonymous on boards they don't own is judged against this board, so
 * the card and the session can never disagree about it.
 */

export type ParsedBoardConfig = { boardType: string; layoutId: number; sizeId: number; setIds: string };

export type ParsedSessionBoardPath = {
  /** `/b/<slug>/<angle>`: gym and LED-less boards */
  slug: string | null;
  /** `/<boardType>/<layout>/<size>/<sets>/<angle>`: every other board, personal LED boards included */
  config: ParsedBoardConfig | null;
  boardType: string | null;
  angle: number | null;
};

function toAngle(angle: number | null): number | null {
  return angle !== null && Number.isInteger(angle) && angle >= -90 && angle <= 90 ? angle : null;
}

/**
 * Pull what a board path says about its board, through the shared board-path
 * parsers (`parseNamedBoardPath` for `/b/<slug>`, `parseBoardPath` for a config
 * path). Both tolerate a missing leading slash, which older rows carry.
 */
export function parseSessionBoardPath(boardPath: string | null | undefined): ParsedSessionBoardPath {
  const path = boardPath ?? '';
  const named = parseNamedBoardPath(path);
  if (named) return { slug: named.slug, config: null, boardType: null, angle: toAngle(named.angle) };
  const parsed = parseBoardPath(path);
  if (parsed && Number.isSafeInteger(parsed.layoutId) && Number.isSafeInteger(parsed.sizeId)) {
    return {
      slug: null,
      config: {
        boardType: parsed.boardName,
        layoutId: parsed.layoutId,
        sizeId: parsed.sizeId,
        setIds: normaliseSetIds(parsed.setIds),
      },
      boardType: parsed.boardName,
      angle: toAngle(parsed.angle),
    };
  }
  return { slug: null, config: null, boardType: null, angle: null };
}

// ---------------------------------------------------------------------------
// Board resolution
// ---------------------------------------------------------------------------

export function toBoardId(value: number | string | null | undefined): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export type SessionBoardSource = {
  id: string;
  boardId: number | null;
  boardPath: string | null;
  createdByUserId: string | null;
};

/**
 * The board each session is on, the session's own word first:
 *
 * 1. the `board_sessions.board_id` column (its primary board),
 * 2. the board its path names: `/b/<slug>/…` → `user_boards.slug`, or a legacy
 *    `/spray/<layout>/…` → its spray wall,
 * 3. the Redis session→board binding stamped when a climb is lit through
 *    Boardsesh (`reportBoardClimb`),
 * 4. its newest `boardsesh_ticks` row on a board its author does not own.
 *
 * A config path describes the layout shared by many walls. Owning or following
 * a board with that config never identifies the actual wall being used. That is
 * why step 4 skips a tick on its author's own board: with no wall to go on,
 * `saveTick` files a config-path tick under the author's own board of that
 * config, and the app joining a config-path session selects (or creates) the
 * joiner's own board of that config. Such a tick says which config the climber
 * holds, not which wall they are at.
 *
 * Boards attached to a session (`session_boards`: a multi-board session's
 * other walls, the walls a party moved off) never decide it. A session left
 * unresolved has no known board: a climber who stays anonymous on boards they
 * don't own is then anonymous in it, even if they own a matching config.
 * A failed Redis read leaves the session unresolved rather than guessing on
 * from ticks, so an outage fails closed.
 *
 * Durable `board_climb_events` are deliberately absent from wall resolution:
 * `reportBoardClimb` records the current session after its durable dwell gate,
 * while the live binding above is available earlier. Those events can prove a
 * particular author's own wall action for private-board name sharing.
 *
 * Redis is only asked about sessions the first two steps left unresolved, the
 * tick read only covers what Redis left. `excludeTickUuids` answers "where was
 * it before this tick" for `tickMovedSessionWall`.
 */
export async function resolveSessionBoards(
  sessions: readonly SessionBoardSource[],
  options: { excludeTickUuids?: readonly string[] } = {},
): Promise<Map<string, number>> {
  const resolved = new Map<string, number>();
  if (sessions.length === 0) return resolved;

  const slugBySessionId = new Map<string, string>();
  const sprayLayoutBySessionId = new Map<string, number>();
  for (const session of sessions) {
    const { slug, config } = parseSessionBoardPath(session.boardPath);
    if (slug) slugBySessionId.set(session.id, slug);
    if (config?.boardType === 'spray') sprayLayoutBySessionId.set(session.id, config.layoutId);
  }
  const slugs = [...new Set(slugBySessionId.values())];
  const sprayLayouts = [...new Set(sprayLayoutBySessionId.values())];

  const pathless = sessions.filter((session) => !toBoardId(session.boardId));
  const [slugRows, sprayRows] = await Promise.all([
    slugs.length > 0 && pathless.some((session) => slugBySessionId.has(session.id))
      ? db
          .select({ id: dbSchema.userBoards.id, slug: dbSchema.userBoards.slug })
          .from(dbSchema.userBoards)
          .where(and(inArray(dbSchema.userBoards.slug, slugs), isNull(dbSchema.userBoards.deletedAt)))
      : Promise.resolve([]),
    sprayLayouts.length > 0 && pathless.some((session) => sprayLayoutBySessionId.has(session.id))
      ? db
          .select({ id: dbSchema.userBoards.id, layoutId: dbSchema.sprayWalls.layoutId })
          .from(dbSchema.sprayWalls)
          .innerJoin(dbSchema.userBoards, eq(dbSchema.userBoards.uuid, dbSchema.sprayWalls.boardUuid))
          .where(
            and(
              inArray(dbSchema.sprayWalls.layoutId, sprayLayouts),
              isNull(dbSchema.sprayWalls.deletedAt),
              isNull(dbSchema.userBoards.deletedAt),
            ),
          )
      : Promise.resolve([]),
  ]);
  const boardIdBySlug = new Map(slugRows.map((row) => [row.slug, Number(row.id)]));
  const boardIdBySprayLayout = new Map(sprayRows.map((row) => [Number(row.layoutId), Number(row.id)]));

  for (const session of sessions) {
    const slug = slugBySessionId.get(session.id);
    const sprayLayout = sprayLayoutBySessionId.get(session.id);
    const boardId =
      toBoardId(session.boardId) ??
      (slug ? boardIdBySlug.get(slug) : undefined) ??
      (sprayLayout !== undefined ? boardIdBySprayLayout.get(sprayLayout) : undefined);
    if (boardId) resolved.set(session.id, boardId);
  }

  const failedBindings = new Set<string>();
  const redisBindings = await Promise.all(
    sessions
      .filter((session) => !resolved.has(session.id))
      .map(async ({ id: sessionId }) => {
        try {
          return [sessionId, toBoardId(await pubsub.getSessionBoard(sessionId))] as const;
        } catch (error) {
          logger.warn(`[session-board] session→board binding read failed for ${sessionId}: ${String(error)}`);
          failedBindings.add(sessionId);
          return [sessionId, null] as const;
        }
      }),
  );
  for (const [sessionId, boardId] of redisBindings) {
    if (boardId) resolved.set(sessionId, boardId);
  }

  const ticks = dbSchema.boardseshTicks;
  const unticked = sessions.filter((session) => !resolved.has(session.id) && !failedBindings.has(session.id));
  if (unticked.length > 0) {
    const excludeTickUuids = options.excludeTickUuids ?? [];
    const tickRows = await db
      .selectDistinctOn([ticks.sessionId], { sessionId: ticks.sessionId, boardId: ticks.boardId })
      .from(ticks)
      .innerJoin(dbSchema.userBoards, eq(dbSchema.userBoards.id, ticks.boardId))
      .where(
        and(
          inArray(
            ticks.sessionId,
            unticked.map((session) => session.id),
          ),
          isNotNull(ticks.boardId),
          ne(dbSchema.userBoards.ownerId, ticks.userId),
          excludeTickUuids.length > 0 ? notInArray(ticks.uuid, [...excludeTickUuids]) : undefined,
        ),
      )
      .orderBy(ticks.sessionId, desc(ticks.climbedAt), desc(ticks.id));
    for (const row of tickRows) {
      const boardId = toBoardId(row.boardId);
      if (row.sessionId && boardId) resolved.set(row.sessionId, boardId);
    }
  }

  return resolved;
}

/**
 * Whether a tick just saved into a live session moved the session's wall: the
 * session resolves to another board with the tick than without it. Only the
 * newest-tick rung can move, so a session its primary board places answers
 * false without asking Redis or reading ticks.
 */
export async function tickMovedSessionWall(sessionId: string, tickUuid: string): Promise<boolean> {
  const [session] = await db
    .select({
      id: dbSchema.boardSessions.id,
      boardId: dbSchema.boardSessions.boardId,
      boardPath: dbSchema.boardSessions.boardPath,
      createdByUserId: dbSchema.boardSessions.createdByUserId,
    })
    .from(dbSchema.boardSessions)
    .where(eq(dbSchema.boardSessions.id, sessionId))
    .limit(1);
  if (!session || toBoardId(session.boardId)) return false;
  const [withTick, withoutTick] = await Promise.all([
    resolveSessionBoards([session]),
    resolveSessionBoards([session], { excludeTickUuids: [tickUuid] }),
  ]);
  return withTick.get(sessionId) !== withoutTick.get(sessionId);
}
