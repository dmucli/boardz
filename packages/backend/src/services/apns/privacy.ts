import { canAccessResource } from '../privacy';
import { canReadClimbContent, sessionVisibleUserIds } from '../board-session-privacy';
import { deriveBoardConnection, type BoardHolder } from './board-connection';
import type { LiveActivityContentState } from './index';

import { emptyLiveActivityContentState } from './content-state';

export async function projectLiveActivityContent(
  sessionId: string,
  viewerId: string | null,
  contentState: LiveActivityContentState,
  holder: BoardHolder | null,
): Promise<{ event: 'update' | 'end'; contentState: LiveActivityContentState }> {
  if (!(await canAccessResource('session', sessionId, viewerId))) {
    return { event: 'end', contentState: emptyLiveActivityContentState() };
  }
  const readableClimb = !!contentState.climbUuid && (await canReadClimbContent(contentState.climbUuid, viewerId));
  const projected: LiveActivityContentState = readableClimb
    ? { ...contentState }
    : {
        ...contentState,
        climbName: '',
        climbDifficulty: '',
        climbUuid: '',
        queueItemUuid: '',
        mirrored: false,
      };
  // Neither a cached name nor an omitted optional field may restore a previous
  // private holder name in a device's existing Live Activity state.
  delete projected.boardConnection;
  projected.holderDisplayName = '';
  if (holder) {
    // Named by their account, and anonymous on the session's board when they
    // chose that and it is not theirs: the roster's rule. One lookup.
    const holderUserId = holder.holderUserId;
    const showIdentity =
      !!holderUserId && (await sessionVisibleUserIds([holderUserId], viewerId, sessionId)).has(holderUserId);
    Object.assign(
      projected,
      deriveBoardConnection({
        tokenUserId: viewerId,
        holderUserId: holder.holderUserId,
        holderDisplayName: showIdentity ? holder.holderDisplayName : null,
      }),
    );
  }
  return { event: 'update', contentState: projected };
}
