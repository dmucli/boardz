import { describe, expect, it, vi } from 'vitest';
import type { Climb } from '@boardsesh/queue';
import {
  MAX_LIST_LOADS_PER_TRACK_REQUEST,
  createLoadedListFetchPage,
  createLoadedListTrackLoader,
  type LoadedList,
  type LoadedListTrackLoader,
} from '../loaded-list-pages';

function makeClimbs(prefix: string, count: number, from = 0): Climb[] {
  return Array.from({ length: count }, (_, index) => ({ uuid: `${prefix}-${from + index}` }) as unknown as Climb);
}

function loaded(climbs: Climb[], hasMore: boolean, loadedRows = climbs.length): LoadedList {
  return { climbs, hasMore, loadedRows };
}

const BOARD = { boardName: 'kilter', layoutId: 1, sizeId: 2, setIds: '3', angle: 40 };

function pageArgs(page: number, pageSize: number, signal = new AbortController().signal) {
  return { page, pageSize, board: BOARD, signal };
}

describe('createLoadedListFetchPage', () => {
  it('serves a page from the rows already loaded, without loading more', async () => {
    const loadMore = vi.fn();
    const fetchPage = createLoadedListFetchPage({ read: () => loaded(makeClimbs('row', 5), true), loadMore });

    const page = await fetchPage(pageArgs(1, 2));

    expect(page.climbs.map(({ uuid }) => uuid)).toEqual(['row-2', 'row-3']);
    expect(page.hasMore).toBe(true);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("loads the screen's next pages until the track page is covered", async () => {
    let list = loaded(makeClimbs('row', 2), true);
    const loadMore = vi.fn(async () => {
      const grown = list.climbs.length + 2;
      list = loaded(makeClimbs('row', grown), grown < 6);
      return list;
    });
    const fetchPage = createLoadedListFetchPage({ read: () => list, loadMore });

    const page = await fetchPage(pageArgs(1, 3));

    expect(loadMore).toHaveBeenCalledTimes(2);
    expect(page.climbs.map(({ uuid }) => uuid)).toEqual(['row-3', 'row-4', 'row-5']);
    expect(page.hasMore).toBe(false);
  });

  it('keeps going through a page of repeats, which adds rows and no climbs', async () => {
    let list = loaded(makeClimbs('row', 2), true, 2);
    const loadMore = vi
      .fn()
      .mockImplementationOnce(async () => {
        list = loaded(list.climbs, true, 4);
        return list;
      })
      .mockImplementationOnce(async () => {
        list = loaded(makeClimbs('row', 4), false, 6);
        return list;
      });
    const fetchPage = createLoadedListFetchPage({ read: () => list, loadMore });

    const page = await fetchPage(pageArgs(1, 2));

    expect(page.climbs.map(({ uuid }) => uuid)).toEqual(['row-2', 'row-3']);
  });

  it('ends the track after two loads in a row add no rows, rather than asking forever', async () => {
    const stuck = loaded(makeClimbs('row', 2), true);
    const loadMore = vi.fn(async () => stuck);
    const fetchPage = createLoadedListFetchPage({ read: () => stuck, loadMore });

    const page = await fetchPage(pageArgs(1, 2));

    expect(loadMore).toHaveBeenCalledTimes(2);
    // No `hasMore`: a short page that said there was more would send the next
    // track page past every climb it never served.
    expect(page).toEqual({ climbs: [], hasMore: false });
  });

  it('loads again after a load that rode an in-flight refetch, so no climbs are skipped', async () => {
    // Logging a tick refetches the logbook. A load asked for meanwhile
    // resolves with the refetch's pages, adding nothing; the next one is real.
    let list = loaded(makeClimbs('row', 60), true, 60);
    const loadMore = vi
      .fn()
      .mockImplementationOnce(async () => list)
      .mockImplementation(async () => {
        const grown = list.climbs.length + 20;
        list = loaded(makeClimbs('row', grown), grown < 300, grown);
        return list;
      });
    const fetchPage = createLoadedListFetchPage({ read: () => list, loadMore });

    const first = await fetchPage(pageArgs(0, 100));
    const second = await fetchPage(pageArgs(1, 100));

    expect(first.climbs).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect([...first.climbs, ...second.climbs].map(({ uuid }) => uuid)).toEqual(
      makeClimbs('row', 200).map(({ uuid }) => uuid),
    );
  });

  it('fills a track page however many repeat-heavy pages it takes, so the next page loses no climbs', async () => {
    // A project-heavy logbook: each 20-row page adds 6 new climbs, so 100
    // climbs take 17 pages. The track asks page 0, then page 1 from climb 100;
    // a page 0 that stopped short would leave a gap the track never serves.
    let list = loaded([], true, 0);
    const loadMore = vi.fn(async () => {
      const climbCount = list.climbs.length + 6;
      list = loaded(makeClimbs('row', climbCount), climbCount < 240, list.loadedRows + 20);
      return list;
    });
    const fetchPage = createLoadedListFetchPage({ read: () => list, loadMore });

    const first = await fetchPage(pageArgs(0, 100));
    const second = await fetchPage(pageArgs(1, 100));

    expect(first.climbs).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect([...first.climbs, ...second.climbs].map(({ uuid }) => uuid)).toEqual(
      makeClimbs('row', 200).map(({ uuid }) => uuid),
    );
  });

  it('keeps loading a feed that adds rows and no climbs until it ends', async () => {
    let rows = 0;
    const loadMore = vi.fn(async () => {
      rows += 1;
      return loaded([], rows < 30, rows);
    });
    const fetchPage = createLoadedListFetchPage({ read: () => loaded([], true, rows), loadMore });

    const page = await fetchPage(pageArgs(0, 100));

    expect(loadMore).toHaveBeenCalledTimes(30);
    expect(page).toEqual({ climbs: [], hasMore: false });
  });

  it('stops loading once the track page is aborted', async () => {
    const controller = new AbortController();
    let rows = 0;
    const loadMore = vi.fn(async () => {
      rows += 1;
      if (rows === 3) controller.abort();
      return loaded([], true, rows);
    });
    const fetchPage = createLoadedListFetchPage({ read: () => loaded([], true, rows), loadMore });

    await expect(fetchPage(pageArgs(0, 100, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadMore).toHaveBeenCalledTimes(3);
  });

  it('ends the track once the screen shows another list', async () => {
    const loadMore = vi.fn();
    const fetchPage = createLoadedListFetchPage(
      { read: () => loaded(makeClimbs('row', 5), true), loadMore },
      () => false,
    );

    await expect(fetchPage(pageArgs(0, 2))).resolves.toEqual({ climbs: [], hasMore: false });
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('rejects an aborted page as an abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchPage = createLoadedListFetchPage({ read: () => loaded([], true), loadMore: vi.fn() });

    await expect(fetchPage(pageArgs(0, 2, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function uuids(climbs: Climb[]): string[] {
  return climbs.map(({ uuid }) => uuid);
}

/** Walk a track the way the player does, one request at a time, from `offset`. */
async function walk(loader: LoadedListTrackLoader, loadMore: { mock: { calls: unknown[] } }, offset = 0) {
  const served: Climb[] = [];
  const loadsPerRequest: number[] = [];
  let nextOffset: number | null = offset;
  while (nextOffset !== null) {
    const loadsBefore = loadMore.mock.calls.length;
    const load = await loader({ offset: nextOffset, count: 100, signal: new AbortController().signal });
    loadsPerRequest.push(loadMore.mock.calls.length - loadsBefore);
    served.push(...load.climbs);
    nextOffset = load.nextOffset;
    if (loadsPerRequest.length > 100) throw new Error('the walk never ended');
  }
  return { served, loadsPerRequest };
}

describe('createLoadedListTrackLoader', () => {
  it('serves climbs from the offset out of the rows already loaded, without loading more', async () => {
    const loadMore = vi.fn();
    const loader = createLoadedListTrackLoader({ read: () => loaded(makeClimbs('row', 5), true), loadMore });

    const load = await loader({ offset: 2, count: 2, signal: new AbortController().signal });

    expect(uuids(load.climbs)).toEqual(['row-2', 'row-3']);
    expect(load.nextOffset).toBe(4);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('walks a slow-filling logbook across requests: no climb skipped, a few loads per request', async () => {
    // A project-heavy logbook: each 20-row page adds 6 new climbs, so 100
    // climbs take 17 pages. One request used to load all 17 (and a logbook of
    // fewer than 100 climbs all of its pages); now each loads a few and the
    // next starts at the first climb not served.
    let list = loaded([], true, 0);
    const loadMore = vi.fn(async () => {
      const climbCount = list.climbs.length + 6;
      list = loaded(makeClimbs('row', climbCount), climbCount < 240, list.loadedRows + 20);
      return list;
    });
    const loader = createLoadedListTrackLoader({ read: () => list, loadMore });

    const { served, loadsPerRequest } = await walk(loader, loadMore);

    expect(uuids(served)).toEqual(uuids(makeClimbs('row', 240)));
    expect(loadsPerRequest.length).toBeGreaterThan(2);
    expect(Math.max(...loadsPerRequest)).toBeLessThanOrEqual(MAX_LIST_LOADS_PER_TRACK_REQUEST);
  });

  it('stops after a few loads of a feed that adds rows and no climbs, and carries on from the same place', async () => {
    let rows = 0;
    const loadMore = vi.fn(async () => {
      rows += 1;
      return loaded([], rows < 30, rows);
    });
    const loader = createLoadedListTrackLoader({ read: () => loaded([], true, rows), loadMore });

    const load = await loader({ offset: 0, count: 100, signal: new AbortController().signal });

    expect(loadMore).toHaveBeenCalledTimes(MAX_LIST_LOADS_PER_TRACK_REQUEST);
    expect(load).toEqual({ climbs: [], nextOffset: 0 });
  });

  it('loads again after a load that rode an in-flight refetch, so no climbs are skipped', async () => {
    // Logging a tick refetches the logbook. A load asked for meanwhile
    // resolves with the refetch's pages, adding nothing; the next one is real.
    let list = loaded(makeClimbs('row', 60), true, 60);
    const loadMore = vi
      .fn()
      .mockImplementationOnce(async () => list)
      .mockImplementation(async () => {
        const grown = list.climbs.length + 20;
        list = loaded(makeClimbs('row', grown), grown < 300, grown);
        return list;
      });
    const loader = createLoadedListTrackLoader({ read: () => list, loadMore });

    const first = await loader({ offset: 60, count: 100, signal: new AbortController().signal });
    expect(first.nextOffset).toBe(60 + first.climbs.length);
    const { served } = await walk(loader, loadMore, first.nextOffset ?? 0);

    expect(uuids([...first.climbs, ...served])).toEqual(uuids(makeClimbs('row', 240, 60)));
  });

  it('ends the track after two loads in a row add no rows, rather than asking forever', async () => {
    const stuck = loaded(makeClimbs('row', 2), true);
    const loadMore = vi.fn(async () => stuck);
    const loader = createLoadedListTrackLoader({ read: () => stuck, loadMore });

    const load = await loader({ offset: 1, count: 100, signal: new AbortController().signal });

    expect(loadMore).toHaveBeenCalledTimes(2);
    expect(uuids(load.climbs)).toEqual(['row-1']);
    expect(load.nextOffset).toBeNull();
  });

  it('ends the track once the screen shows another list', async () => {
    const loadMore = vi.fn();
    const loader = createLoadedListTrackLoader(
      { read: () => loaded(makeClimbs('row', 5), true), loadMore },
      () => false,
    );

    await expect(loader({ offset: 0, count: 2, signal: new AbortController().signal })).resolves.toEqual({
      climbs: [],
      nextOffset: null,
    });
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('rejects an aborted request as an abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const loader = createLoadedListTrackLoader({ read: () => loaded([], true), loadMore: vi.fn() });

    await expect(loader({ offset: 0, count: 2, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
