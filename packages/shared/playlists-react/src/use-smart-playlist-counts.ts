import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  GET_MY_SMART_PLAYLIST_COUNTS,
  type GetMySmartPlaylistCountsQueryResponse,
  type SmartPlaylistCount,
} from '@boardsesh/graphql/operations/playlists';
import { usePlaylistsAdapter, type ExecutePlaylistsGraphQL } from './adapter';

export type UseSmartPlaylistCountsOptions = {
  /** Auth token. Part of the query key (refetch after sign-in/out) and gates
   *  `enabled` so signed-out users don't fire the query. */
  token: string | null;
  /** True while the token is still resolving — disables the query until ready. */
  tokenLoading?: boolean;
  /** Whether the user is signed in. Gates `enabled`. */
  isAuthenticated: boolean;
  /** Override the adapter's `executeGraphQL` (used in tests). */
  executeGraphQL?: ExecutePlaylistsGraphQL;
};

/** The first part of the counts' query key, for a caller that refreshes them without rendering the query. */
export const SMART_PLAYLIST_COUNTS_QUERY_KEY = 'mySmartPlaylistCounts';

/**
 * Smart-playlist counts for the signed-in user, used to decide which
 * auto-generated smart-playlist cards to show. react-query handles caching
 * across the session and dedupes if the screen remounts. The token is part of
 * the key so we refetch after sign-in/out, but a 5-minute staleTime avoids
 * refetching every visit.
 */
export function useSmartPlaylistCounts({
  token,
  tokenLoading = false,
  isAuthenticated,
  executeGraphQL: executeGraphQLOverride,
}: UseSmartPlaylistCountsOptions): UseQueryResult<SmartPlaylistCount[]> {
  const adapter = usePlaylistsAdapter();
  const executeGraphQL = executeGraphQLOverride ?? adapter.executeGraphQL;

  return useQuery({
    queryKey: [SMART_PLAYLIST_COUNTS_QUERY_KEY, token ?? null],
    queryFn: async () => {
      const res = await executeGraphQL<GetMySmartPlaylistCountsQueryResponse, Record<string, never>>(
        GET_MY_SMART_PLAYLIST_COUNTS,
        {},
      );
      return res.mySmartPlaylistCounts;
    },
    enabled: !tokenLoading && isAuthenticated && !!token,
    staleTime: 5 * 60 * 1000,
  });
}
