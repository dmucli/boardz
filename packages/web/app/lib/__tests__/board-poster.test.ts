import { describe, it, expect } from 'vite-plus/test';
import {
  availableBoardPosterLayouts,
  boardPosterBackHref,
  boardPosterConsoleHref,
  boardPosterHref,
  boardPosterTarget,
  parseBoardPosterLayout,
  type BoardPosterBoard,
} from '../board-poster';

const WALL_UUID = '0144249a-3a8c-47c2-8c1e-54c0c572fe02';
const OTHER_UUID = '11111111-1111-4111-8111-111111111111';
const INVITE_TOKEN = 'Ab3_dE-fGhIjKlMnOpQrSt';

function sprayWall(overrides: Partial<BoardPosterBoard> = {}): BoardPosterBoard {
  return {
    uuid: WALL_UUID,
    slug: 'alejandro-s-nchez-s-spraywall-2',
    boardType: 'spray',
    isPublic: true,
    isUnlisted: false,
    ...overrides,
  };
}

function ledBoard(overrides: Partial<BoardPosterBoard> = {}): BoardPosterBoard {
  return {
    uuid: 'b0a7d000-0000-4000-8000-000000000001',
    slug: 'main-kilter',
    boardType: 'kilter',
    isPublic: true,
    isUnlisted: false,
    ...overrides,
  };
}

// Every printed URL below is spelled out byte for byte. It goes on paper and
// onto a wall, where a wrong character cannot be patched afterwards.
describe('boardPosterTarget — Spraywalls', () => {
  it('prints a public wall with the plain slug code and a typed line', () => {
    expect(boardPosterTarget(sprayWall(), undefined)).toEqual({
      kind: 'spray',
      qrUrl: 'https://www.boardsesh.com/b/alejandro-s-nchez-s-spraywall-2?src=qr&medium=board',
      typedUrl: 'www.boardsesh.com/b/alejandro-s-nchez-s-spraywall-2',
      wallCapability: null,
    });
  });

  it('still prints a public wall reached with its own uuid, without carrying it', () => {
    const target = boardPosterTarget(sprayWall(), WALL_UUID);
    expect(target?.qrUrl).toBe('https://www.boardsesh.com/b/alejandro-s-nchez-s-spraywall-2?src=qr&medium=board');
    expect(target?.wallCapability).toBeNull();
  });

  it("refuses a public wall reached with somebody else's uuid, as its page does", () => {
    expect(boardPosterTarget(sprayWall(), OTHER_UUID)).toBeNull();
  });

  it('prints an unlisted wall with the matching uuid: wall first in the code, no typed line', () => {
    expect(boardPosterTarget(sprayWall({ isPublic: false, isUnlisted: true }), WALL_UUID)).toEqual({
      kind: 'spray',
      qrUrl:
        'https://www.boardsesh.com/b/alejandro-s-nchez-s-spraywall-2?wall=0144249a-3a8c-47c2-8c1e-54c0c572fe02&src=qr&medium=board',
      typedUrl: null,
      wallCapability: WALL_UUID,
    });
  });

  it('refuses an unlisted wall without a uuid, with a wrong one, and with a repeated one', () => {
    const unlisted = sprayWall({ isPublic: false, isUnlisted: true });
    expect(boardPosterTarget(unlisted, undefined)).toBeNull();
    expect(boardPosterTarget(unlisted, OTHER_UUID)).toBeNull();
    expect(boardPosterTarget(unlisted, [WALL_UUID, OTHER_UUID])).toBeNull();
  });

  it('refuses a private wall, even with its own uuid', () => {
    const privateWall = sprayWall({ isPublic: false, isUnlisted: false });
    expect(boardPosterTarget(privateWall, undefined)).toBeNull();
    expect(boardPosterTarget(privateWall, WALL_UUID)).toBeNull();
  });
});

describe('boardPosterTarget — LED boards', () => {
  it('prints a public board with the plain slug code and a typed line', () => {
    expect(boardPosterTarget(ledBoard(), undefined)).toEqual({
      kind: 'led',
      qrUrl: 'https://www.boardsesh.com/b/main-kilter?src=qr&medium=board',
      typedUrl: 'www.boardsesh.com/b/main-kilter',
      wallCapability: null,
    });
  });

  it("prints an unlisted board with the same plain link the app's share sheet hands out", () => {
    expect(boardPosterTarget(ledBoard({ isPublic: false, isUnlisted: true }), undefined)).toEqual({
      kind: 'led',
      qrUrl: 'https://www.boardsesh.com/b/main-kilter?src=qr&medium=board',
      typedUrl: 'www.boardsesh.com/b/main-kilter',
      wallCapability: null,
    });
  });

  it('refuses Followers, Invite-only and Only me boards, which share the same stored flags', () => {
    expect(boardPosterTarget(ledBoard({ isPublic: false, isUnlisted: false }), undefined)).toBeNull();
  });

  it('never carries a ?wall= value onto an LED board code', () => {
    expect(boardPosterTarget(ledBoard(), OTHER_UUID)?.qrUrl).toBe(
      'https://www.boardsesh.com/b/main-kilter?src=qr&medium=board',
    );
  });

  it('percent-encodes a slug in the code and the typed line alike', () => {
    const target = boardPosterTarget(ledBoard({ slug: 'kilter #2' }), undefined);
    expect(target?.qrUrl).toBe('https://www.boardsesh.com/b/kilter%20%232?src=qr&medium=board');
    expect(target?.typedUrl).toBe('www.boardsesh.com/b/kilter%20%232');
  });
});

describe('the invite token never reaches a poster', () => {
  // `?invite=` is a one-person capability for Followers / Invite-only boards.
  // The rule does not read it at all — there is no parameter to pass it in —
  // and nothing it builds contains it.
  it('gives every printable board a code and links without it', () => {
    for (const board of [ledBoard(), ledBoard({ isPublic: false, isUnlisted: true }), sprayWall()]) {
      const target = boardPosterTarget(board, undefined);
      expect(target?.qrUrl).not.toContain('invite');
      expect(boardPosterHref(board.slug, { wallCapability: target?.wallCapability })).not.toContain('invite');
      expect(boardPosterBackHref(board.slug, target?.wallCapability ?? null)).not.toContain(INVITE_TOKEN);
    }
  });
});

describe('poster layouts', () => {
  it('offers the photo poster only when there is a photo', () => {
    expect(availableBoardPosterLayouts(true)).toEqual(['photo', 'plain', 'cards']);
    expect(availableBoardPosterLayouts(false)).toEqual(['plain', 'cards']);
  });

  it('defaults to the photo poster with a photo and the plain one without', () => {
    expect(parseBoardPosterLayout(undefined, true)).toBe('photo');
    expect(parseBoardPosterLayout(undefined, false)).toBe('plain');
  });

  it('takes a known layout', () => {
    expect(parseBoardPosterLayout('plain', true)).toBe('plain');
    expect(parseBoardPosterLayout('cards', false)).toBe('cards');
  });

  it('never prints the photo poster for a board without a photo', () => {
    expect(parseBoardPosterLayout('photo', false)).toBe('plain');
  });

  it('falls back to the default for anything unknown or repeated', () => {
    expect(parseBoardPosterLayout('violet', true)).toBe('photo');
    expect(parseBoardPosterLayout('', false)).toBe('plain');
    expect(parseBoardPosterLayout(['cards', 'plain'], true)).toBe('photo');
  });
});

describe('poster links', () => {
  it('builds the poster path, wall first, then the layout', () => {
    expect(boardPosterHref('main-kilter')).toBe('/poster/b/main-kilter');
    expect(boardPosterHref('main-kilter', { layout: 'cards' })).toBe('/poster/b/main-kilter?layout=cards');
    expect(boardPosterHref('garage', { wallCapability: WALL_UUID, layout: 'plain' })).toBe(
      `/poster/b/garage?wall=${WALL_UUID}&layout=plain`,
    );
  });

  it('goes back to the board, keeping the capability an unlisted wall needs', () => {
    expect(boardPosterBackHref('main-kilter', null)).toBe('/b/main-kilter');
    expect(boardPosterBackHref('garage', WALL_UUID)).toBe(`/b/garage?wall=${WALL_UUID}`);
  });
});

describe('boardPosterConsoleHref — the gym console action', () => {
  it('links a public wall and a public or unlisted LED board without a capability', () => {
    expect(boardPosterConsoleHref(sprayWall())).toBe('/poster/b/alejandro-s-nchez-s-spraywall-2');
    expect(boardPosterConsoleHref(ledBoard())).toBe('/poster/b/main-kilter');
    expect(boardPosterConsoleHref(ledBoard({ isPublic: false, isUnlisted: true }))).toBe('/poster/b/main-kilter');
  });

  it('links an unlisted wall with its own uuid, the capability its share link carries', () => {
    expect(boardPosterConsoleHref(sprayWall({ isPublic: false, isUnlisted: true }))).toBe(
      `/poster/b/alejandro-s-nchez-s-spraywall-2?wall=${WALL_UUID}`,
    );
  });

  it('offers nothing for a private wall, a private LED board, or a board with no slug', () => {
    expect(boardPosterConsoleHref(sprayWall({ isPublic: false, isUnlisted: false }))).toBeNull();
    expect(boardPosterConsoleHref(ledBoard({ isPublic: false, isUnlisted: false }))).toBeNull();
    expect(boardPosterConsoleHref(ledBoard({ slug: '' }))).toBeNull();
  });
});
