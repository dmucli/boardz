import { describe, expect, it, vi } from 'vitest';

vi.mock('../../client', () => ({ getHttpClient: () => ({ request: vi.fn() }) }));
import type { RecentBetaLinkGqlRow } from '@boardsesh/graphql/operations/beta-links';
import { selectRecentBetaVideos } from '../use-recent-beta-links';

function row(link: string, climbName = 'Slab Dog'): RecentBetaLinkGqlRow {
  return {
    climbName,
    boardType: 'kilter',
    layoutId: 1,
    betaLink: {
      climbUuid: 'climb-1',
      link,
      foreignUsername: null,
      angle: 40,
      thumbnail: null,
      isListed: true,
      createdAt: '2026-10-18T00:00:00Z',
      tickUuid: null,
      boardId: null,
    },
  } as RecentBetaLinkGqlRow;
}

describe('selectRecentBetaVideos', () => {
  it('keeps videos only, once each, up to the limit', () => {
    const rows = [
      row('https://www.instagram.com/p/one/'),
      row('https://example.com/not-a-video'),
      row('https://www.instagram.com/p/one/?igsh=again'),
      row('https://www.tiktok.com/@climber/video/123'),
      row('https://www.instagram.com/p/three/'),
    ];
    const videos = selectRecentBetaVideos(rows, 2);
    expect(videos.map((video) => video.betaLink.link)).toEqual([
      'https://www.instagram.com/p/one/',
      'https://www.tiktok.com/@climber/video/123',
    ]);
    expect(videos[0].climbName).toBe('Slab Dog');
    expect(videos[0].betaLink.climb_uuid).toBe('climb-1');
  });
});
