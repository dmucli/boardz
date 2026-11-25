import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DISCOVER_PLAYLISTS,
  type DiscoverablePlaylist,
  type DiscoverPlaylistsInput,
  type DiscoverPlaylistsQueryResponse,
} from '@boardsesh/graphql/operations/playlists';
import { usePlaylistsAdapter, type ExecutePlaylistsGraphQL } from './adapter';
import type { CommunityPlaylistsInput } from './community-playlist-filters';

export type UseCommunityPlaylistsOptions = {
  /**
   * Server input without the page cursor, usually from
   * `buildCommunityPlaylistsInput`. Compared by content, so a fresh object with
   * the same fields does not refetch; any changed field resets to page 0.
   */
  input: CommunityPlaylistsInput;
  /** Page size per request. Defaults to 20. */
  pageSize?: number;
  /** Whether requests should run. Defaults to true. */
  enabled?: boolean;
  /** Override the adapter's `executeGraphQL` (used in tests). */
  executeGraphQL?: ExecutePlaylistsGraphQL;
};

export type UseCommunityPlaylistsResult = {
  playlists: DiscoverablePlaylist[];
  /** Server total for the current input. 0 until the first page lands. */
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  /**
   * The latest first-page request failed: the first load (no rows) or a
   * refresh (the previous rows stay, and so does their pagination).
   */
  hasError: boolean;
  /** A page after the first failed; pagination stops until `retryLoadMore`. */
  hasLoadMoreError: boolean;
  /** Fetches the next page. One page per call, never a drain. */
  loadMore: () => void;
  retryLoadMore: () => void;
  refetch: () => void;
};

/** Appends rows whose uuid isn't on screen yet, de-duplicating the page itself too. */
function appendUnique(previous: DiscoverablePlaylist[], incoming: DiscoverablePlaylist[]): DiscoverablePlaylist[] {
  const seen = new Set(previous.map((playlist) => playlist.uuid));
  const fresh: DiscoverablePlaylist[] = [];
  for (const playlist of incoming) {
    if (seen.has(playlist.uuid)) continue;
    seen.add(playlist.uuid);
    fresh.push(playlist);
  }
  return fresh.length > 0 ? [...previous, ...fresh] : previous;
}

/**
 * One sorted, filtered, paginated stream of public playlists — the full
 * Community Playlists list. Unlike `useDiscoverPlaylists` (two merged streams
 * for the hub shelf), this fetches a single `sortBy`, so the order the climber
 * picked is the order they see.
 *
 *  - Any change to `input` drops the loaded rows and fetches page 0. A response
 *    for an older input is discarded, so fast typing can't land stale rows.
 *  - Offset pages can shift between requests (a playlist gains a pin and moves
 *    up), so appended rows are de-duplicated by uuid.
 *  - A failed page stops pagination and raises `hasLoadMoreError` at once, so
 *    the screen shows its retry. Silent auto-retries don't work here: a list
 *    parked at its end only fires end-reach again after the climber scrolls
 *    away and back, so a quiet failure would look like the end of the list.
 *  - A failed refresh keeps the rows and their pagination and raises
 *    `hasError`, so the screen can offer a retry beside them.
 */
export function useCommunityPlaylists({
  input,
  pageSize = 20,
  enabled = true,
  executeGraphQL: executeGraphQLOverride,
}: UseCommunityPlaylistsOptions): UseCommunityPlaylistsResult {
  const adapter = usePlaylistsAdapter();
  const executeGraphQL = executeGraphQLOverride ?? adapter.executeGraphQL;

  // Content key, so callers don't have to memoise the input object.
  const inputKey = JSON.stringify(input);
  const stableInput = useMemo(() => JSON.parse(inputKey) as CommunityPlaylistsInput, [inputKey]);

  const [playlists, setPlaylists] = useState<DiscoverablePlaylist[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(enabled);
  // The input the current first-page request was started for. Until the
  // effect starts it, a render for a new (or newly enabled) input still reports
  // loading, so the screen never paints one frame of "nothing here".
  const fetchKey = `${inputKey}|${pageSize}`;
  const [startedFetchKey, setStartedFetchKey] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [hasLoadMoreError, setHasLoadMoreError] = useState(false);

  const pageRef = useRef(0);
  const hasMoreRef = useRef(false);
  const isFetchingRef = useRef(false);
  const activeFetchIdRef = useRef(0);

  const fetchPage = useCallback(
    async (page: number, isInitial: boolean) => {
      if (!enabled) return;
      if (!isInitial && isFetchingRef.current) return;

      const fetchId = activeFetchIdRef.current + 1;
      activeFetchIdRef.current = fetchId;
      isFetchingRef.current = true;

      if (isInitial) {
        setIsLoading(true);
        setIsLoadingMore(false);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const response = await executeGraphQL<DiscoverPlaylistsQueryResponse, { input: DiscoverPlaylistsInput }>(
          DISCOVER_PLAYLISTS,
          { input: { ...stableInput, page, pageSize } },
        );
        if (activeFetchIdRef.current !== fetchId) return;

        const { playlists: pagePlaylists, totalCount: total, hasMore: more } = response.discoverPlaylists;
        // A co-owned playlist can come back once per owner row, so the page
        // itself is de-duplicated as well as checked against earlier pages.
        setPlaylists((previous) => appendUnique(isInitial ? [] : previous, pagePlaylists));
        setTotalCount(total);
        setHasMore(more);
        hasMoreRef.current = more;
        pageRef.current = page + 1;
        setHasError(false);
        setHasLoadMoreError(false);
      } catch (err: unknown) {
        if (activeFetchIdRef.current !== fetchId) return;
        console.error('Failed to fetch community playlists:', err);
        if (isInitial) {
          setHasError(true);
        } else {
          setHasMore(false);
          hasMoreRef.current = false;
          setHasLoadMoreError(true);
        }
      } finally {
        if (activeFetchIdRef.current === fetchId) {
          if (isInitial) setIsLoading(false);
          else setIsLoadingMore(false);
          isFetchingRef.current = false;
        }
      }
    },
    [enabled, executeGraphQL, pageSize, stableInput],
  );

  const resetState = useCallback(() => {
    pageRef.current = 0;
    hasMoreRef.current = false;
    setPlaylists([]);
    setTotalCount(0);
    setHasMore(false);
    setHasError(false);
    setHasLoadMoreError(false);
  }, []);

  useEffect(() => {
    resetState();
    if (!enabled) {
      // Orphan any in-flight request so it can't write into a disabled hook.
      activeFetchIdRef.current += 1;
      isFetchingRef.current = false;
      setStartedFetchKey(null);
      setIsLoading(false);
      setIsLoadingMore(false);
      return;
    }
    setStartedFetchKey(fetchKey);
    void fetchPage(0, true);
    // fetchKey changes exactly when fetchPage's input does, so it adds no runs.
  }, [enabled, fetchKey, fetchPage, resetState]);

  const loadMore = useCallback(() => {
    if (isFetchingRef.current || !hasMoreRef.current) return;
    void fetchPage(pageRef.current, false);
  }, [fetchPage]);

  const retryLoadMore = useCallback(() => {
    if (isFetchingRef.current) return;
    setHasLoadMoreError(false);
    setHasMore(true);
    hasMoreRef.current = true;
    void fetchPage(pageRef.current, false);
  }, [fetchPage]);

  // Pagination refs are left alone until the reload lands: a failed refresh
  // (pull-to-refresh offline) keeps the rows on screen, and end-reach must
  // still load their next page. `isFetchingRef` holds `loadMore` off meanwhile,
  // and the success path rewrites the cursor and clears any load-more error.
  const refetch = useCallback(() => {
    void fetchPage(0, true);
  }, [fetchPage]);

  return {
    playlists,
    totalCount,
    isLoading: isLoading || (enabled && startedFetchKey !== fetchKey),
    isLoadingMore,
    hasMore,
    hasError,
    hasLoadMoreError,
    loadMore,
    retryLoadMore,
    refetch,
  };
}
