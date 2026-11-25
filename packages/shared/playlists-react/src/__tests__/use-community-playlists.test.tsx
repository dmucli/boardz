import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PlaylistsAdapterProvider, type ExecutePlaylistsGraphQL, type PlaylistsAdapter } from '../adapter';
import { noopRecentsAdapter } from '../recents-adapter';
import { useCommunityPlaylists } from '../use-community-playlists';
import type { CommunityPlaylistsInput } from '../community-playlist-filters';
import type {
  DiscoverablePlaylist,
  DiscoverPlaylistsInput,
  DiscoverPlaylistsQueryResponse,
} from '@boardsesh/graphql/operations/playlists';

function makeDiscoverable(uuid: string): DiscoverablePlaylist {
  return {
    id: uuid,
    uuid,
    boardType: 'kilter',
    layoutId: 1,
    name: `Playlist ${uuid}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    climbCount: 3,
    creatorId: 'creator-1',
    creatorName: 'Creator One',
    isGeneratedRecommendation: false,
  };
}

function page(uuids: string[], hasMore: boolean, totalCount = uuids.length): DiscoverPlaylistsQueryResponse {
  return { discoverPlaylists: { playlists: uuids.map(makeDiscoverable), totalCount, hasMore } };
}

type PendingRequest = {
  input: DiscoverPlaylistsInput;
  resolve: (response: DiscoverPlaylistsQueryResponse) => void;
  reject: (error: Error) => void;
};

function deferredTransport() {
  const pending: PendingRequest[] = [];
  const executeGraphQL = vi.fn(
    (_query: string, variables: { input: DiscoverPlaylistsInput }) =>
      new Promise<DiscoverPlaylistsQueryResponse>((resolve, reject) => {
        pending.push({ input: variables.input, resolve, reject });
      }),
  ) as unknown as ExecutePlaylistsGraphQL;
  return { pending, executeGraphQL };
}

function wrapper({ children }: { children: ReactNode }) {
  const adapter: PlaylistsAdapter = {
    executeGraphQL: (async () => {
      throw new Error('use the executeGraphQL option');
    }) as ExecutePlaylistsGraphQL,
    recents: noopRecentsAdapter,
  };
  return <PlaylistsAdapterProvider value={adapter}>{children}</PlaylistsAdapterProvider>;
}

const BASE_INPUT: CommunityPlaylistsInput = { boardType: 'kilter', layoutId: 8, sortBy: 'popular' };

describe('useCommunityPlaylists', () => {
  it('fetches page 0 of the given input as a single stream', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result } = renderHook(() => useCommunityPlaylists({ input: BASE_INPUT, pageSize: 2, executeGraphQL }), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].input).toEqual({ ...BASE_INPUT, page: 0, pageSize: 2 });

    await act(async () => pending[0].resolve(page(['a', 'b'], true, 5)));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['a', 'b']);
    expect(result.current.totalCount).toBe(5);
    expect(result.current.hasMore).toBe(true);
  });

  it('loads one page per loadMore and de-duplicates rows that shifted pages', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result } = renderHook(() => useCommunityPlaylists({ input: BASE_INPUT, pageSize: 2, executeGraphQL }), {
      wrapper,
    });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(page(['a', 'b'], true)));

    act(() => result.current.loadMore());
    // A second end-reach while the page is in flight is ignored.
    act(() => result.current.loadMore());
    expect(pending).toHaveLength(2);
    expect(pending[1].input.page).toBe(1);

    await act(async () => pending[1].resolve(page(['b', 'c'], false)));
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);

    act(() => result.current.loadMore());
    expect(pending).toHaveLength(2);
  });

  it('does not refetch for an equal input object, and resets on a changed one', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result, rerender } = renderHook(
      ({ input }: { input: CommunityPlaylistsInput }) => useCommunityPlaylists({ input, executeGraphQL }),
      { initialProps: { input: BASE_INPUT }, wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(page(['a'], false)));

    rerender({ input: { ...BASE_INPUT } });
    expect(pending).toHaveLength(1);

    rerender({ input: { ...BASE_INPUT, minClimbs: 31 } });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(result.current.playlists).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(pending[1].input).toMatchObject({ minClimbs: 31, page: 0 });
  });

  it('drops a response that belongs to an older input', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result, rerender } = renderHook(
      ({ input }: { input: CommunityPlaylistsInput }) => useCommunityPlaylists({ input, executeGraphQL }),
      { initialProps: { input: { ...BASE_INPUT, name: 'cr' } }, wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender({ input: { ...BASE_INPUT, name: 'crimps' } });
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1].resolve(page(['fresh'], false)));
    await act(async () => pending[0].resolve(page(['stale'], false)));

    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['fresh']);
    expect(result.current.isLoading).toBe(false);
  });

  it('flags a failed first page and recovers on refetch', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCommunityPlaylists({ input: BASE_INPUT, executeGraphQL }), { wrapper });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].reject(new Error('boom')));
    expect(result.current.hasError).toBe(true);
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.refetch());
    expect(result.current.isLoading).toBe(true);
    await act(async () => pending[1].resolve(page(['a'], false)));
    expect(result.current.hasError).toBe(false);
    expect(result.current.playlists).toHaveLength(1);
    consoleError.mockRestore();
  });

  it('keeps paginating the loaded rows after a failed refresh', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCommunityPlaylists({ input: BASE_INPUT, executeGraphQL }), { wrapper });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(page(['a'], true)));

    act(() => result.current.refetch());
    await act(async () => pending[1].reject(new Error('offline')));
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['a']);
    expect(result.current.hasError).toBe(true);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    expect(pending).toHaveLength(3);
    expect(pending[2].input.page).toBe(1);
    consoleError.mockRestore();
  });

  it('stops paginating on the first failed page and re-arms on retryLoadMore', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useCommunityPlaylists({ input: BASE_INPUT, executeGraphQL }), { wrapper });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(page(['a'], true)));

    act(() => result.current.loadMore());
    await act(async () => pending[1].reject(new Error('boom')));
    expect(result.current.hasLoadMoreError).toBe(true);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);

    // End-reach no longer fetches; only the explicit retry does.
    act(() => result.current.loadMore());
    expect(pending).toHaveLength(2);

    act(() => result.current.retryLoadMore());
    expect(pending).toHaveLength(3);
    expect(pending[2].input.page).toBe(1);
    await act(async () => pending[2].resolve(page(['b'], false)));
    expect(result.current.hasLoadMoreError).toBe(false);
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['a', 'b']);
    consoleError.mockRestore();
  });

  it('de-duplicates repeats inside a single page', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result } = renderHook(() => useCommunityPlaylists({ input: BASE_INPUT, executeGraphQL }), { wrapper });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(page(['a', 'a', 'b'], true)));
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['a', 'b']);

    act(() => result.current.loadMore());
    await act(async () => pending[1].resolve(page(['c', 'c', 'b'], false)));
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['a', 'b', 'c']);
  });

  it('clears the load-more spinner when the input changes mid-page', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result, rerender } = renderHook(
      ({ input }: { input: CommunityPlaylistsInput }) => useCommunityPlaylists({ input, executeGraphQL }),
      { initialProps: { input: BASE_INPUT }, wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve(page(['a'], true)));

    act(() => result.current.loadMore());
    expect(result.current.isLoadingMore).toBe(true);

    rerender({ input: { ...BASE_INPUT, sortBy: 'recent' } });
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(result.current.isLoadingMore).toBe(false);

    // The stale page lands after the reset and is dropped.
    await act(async () => pending[1].resolve(page(['stale'], false)));
    await act(async () => pending[2].resolve(page(['fresh'], false)));
    expect(result.current.playlists.map((playlist) => playlist.uuid)).toEqual(['fresh']);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('drops an in-flight page when it is disabled mid-request', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCommunityPlaylists({ input: BASE_INPUT, enabled, executeGraphQL }),
      { initialProps: { enabled: true }, wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender({ enabled: false });
    expect(result.current.isLoading).toBe(false);
    await act(async () => pending[0].resolve(page(['late'], false)));
    expect(result.current.playlists).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not fetch while disabled', async () => {
    const { pending, executeGraphQL } = deferredTransport();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCommunityPlaylists({ input: BASE_INPUT, enabled, executeGraphQL }),
      { initialProps: { enabled: false }, wrapper },
    );
    expect(result.current.isLoading).toBe(false);
    expect(pending).toHaveLength(0);

    rerender({ enabled: true });
    // Loading from the very first enabled render, before the request starts.
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(pending).toHaveLength(1));
  });
});
