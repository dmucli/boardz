// Who may print a QR poster for a board, and what the printed code says (#4415).
//
// Pure and synchronous, so the poster page, the gym console's "Print poster"
// action and the tests all get the same answer. A poster is printed and taped to
// a wall: a refusal here is cheap, a code that opens the wrong thing (or a
// private board) is laminated.
//
// The rule, by board:
//
// | Board | Prints | The code opens | Typed line |
// | --- | --- | --- | --- |
// | Spraywall, public | yes | `/b/{slug}` | yes |
// | Spraywall, unlisted, `?wall=` matches | yes | `/b/{slug}?wall={uuid}` | no |
// | Spraywall, unlisted, no or wrong `?wall=` | 404 | | |
// | Spraywall, private | 404 | | |
// | LED board, Public or Unlisted | yes | `/b/{slug}` | yes |
// | LED board, Followers / Invite-only / Only me | 404 | | |
//
// A Spraywall reuses `resolveSprayWallAccess`, the rule its own page and share
// link already apply, so the poster can never open a wall its page would refuse.
// An LED board's Unlisted link is the plain slug (`board-share-link.ts` in the
// app hands out the same URL), so anyone holding the poster holds nothing the
// owner's share sheet would not give them. Followers and Invite-only boards
// share through a minted `?invite=` token, which is a capability for one person:
// this module never reads, forwards or prints it, and those boards get no
// poster at all.

import { posterTypedUrl } from '@/app/components/poster/poster-typed-url';
import { boardQrUrl } from '@/app/lib/gym-attribution';
import { WALL_CAPABILITY_PARAM, resolveSprayWallAccess } from '@/app/lib/spray/spray-visibility';

const SPRAY_BOARD_TYPE = 'spray';

/** The query param that picks a layout on `/poster/b/{slug}`. */
export const BOARD_POSTER_LAYOUT_PARAM = 'layout';

/**
 * The three sheets an owner can print: a photo poster (Spraywalls with a
 * published photo only), a plain poster, and a sheet of four cards.
 */
export const BOARD_POSTER_LAYOUTS = ['photo', 'plain', 'cards'] as const;
export type BoardPosterLayout = (typeof BOARD_POSTER_LAYOUTS)[number];

/** The board fields the rule reads. Structural, so a `ResolvedBoard` and a `UserBoard` both fit. */
export type BoardPosterBoard = {
  uuid: string;
  slug: string;
  boardType: string;
  isPublic: boolean;
  isUnlisted: boolean;
};

export type BoardPosterTarget = {
  /** A Spraywall (photo, its own copy) or an LED board (lights, the compatibility lines). */
  kind: 'spray' | 'led';
  /** The absolute URL the printed code encodes. */
  qrUrl: string;
  /**
   * The line printed for someone whose camera won't scan, scheme stripped, or
   * `null` when the code carries a capability: a 36-character uuid nobody will
   * type, and a printed line that would hand it to every passer-by's camera roll
   * for no gain.
   */
  typedUrl: string | null;
  /**
   * The `?wall=` uuid this poster must keep on every link it makes (the layout
   * switch, the way back), or `null` when the board opens without one.
   */
  wallCapability: string | null;
};

function boardPath(slug: string): string {
  return `/b/${encodeURIComponent(slug)}`;
}

/**
 * What a poster for `board` prints, or `null` when the board gets no poster.
 * `wallParam` is the request's raw `?wall=` value; every refusal is the same
 * `null`, so the page answers one 404 for all of them.
 */
export function boardPosterTarget(
  board: BoardPosterBoard,
  wallParam: string | string[] | undefined,
): BoardPosterTarget | null {
  if (board.boardType === SPRAY_BOARD_TYPE) {
    if (resolveSprayWallAccess(board, wallParam) === 'refuse') return null;
    if (board.isPublic) {
      return {
        kind: 'spray',
        qrUrl: boardQrUrl(board.slug, 'board'),
        typedUrl: posterTypedUrl(boardPath(board.slug)),
        wallCapability: null,
      };
    }
    // Unlisted, and the request presented this wall's own uuid.
    return {
      kind: 'spray',
      qrUrl: boardQrUrl(board.slug, 'board', { wallUuid: board.uuid }),
      typedUrl: null,
      wallCapability: board.uuid,
    };
  }

  if (!board.isPublic && !board.isUnlisted) return null;
  return {
    kind: 'led',
    qrUrl: boardQrUrl(board.slug, 'board'),
    typedUrl: posterTypedUrl(boardPath(board.slug)),
    wallCapability: null,
  };
}

/**
 * The layouts this board can print, in the order the switch shows them. The
 * photo poster needs a photo, so an LED board and a Spraywall with nothing
 * published never offer it.
 */
export function availableBoardPosterLayouts(hasPhoto: boolean): BoardPosterLayout[] {
  return hasPhoto ? [...BOARD_POSTER_LAYOUTS] : BOARD_POSTER_LAYOUTS.filter((layout) => layout !== 'photo');
}

/**
 * The layout a request asked for, or the default: the photo poster when there
 * is a photo, the plain one otherwise. Anything unknown, repeated, or not on
 * offer for this board falls back to the default rather than 404ing — a stale
 * bookmark should still print something.
 */
export function parseBoardPosterLayout(
  layoutParam: string | string[] | undefined,
  hasPhoto: boolean,
): BoardPosterLayout {
  const offered = availableBoardPosterLayouts(hasPhoto);
  const requested = offered.find((layout) => layout === layoutParam);
  return requested ?? (hasPhoto ? 'photo' : 'plain');
}

/**
 * The poster page's own path for one board, carrying the wall capability when
 * the board needs one and the layout when it is not the default. Used by the
 * layout switch and the gym console's "Print poster" action.
 */
export function boardPosterHref(
  slug: string,
  options: { wallCapability?: string | null; layout?: BoardPosterLayout | null } = {},
): string {
  const params = new URLSearchParams();
  if (options.wallCapability) params.set(WALL_CAPABILITY_PARAM, options.wallCapability);
  if (options.layout) params.set(BOARD_POSTER_LAYOUT_PARAM, options.layout);
  const query = params.toString();
  return `/poster${boardPath(slug)}${query ? `?${query}` : ''}`;
}

/**
 * The page a printed poster's "back" link returns to: the board itself, with
 * the wall capability an unlisted Spraywall needs to open.
 */
export function boardPosterBackHref(slug: string, wallCapability: string | null): string {
  if (!wallCapability) return boardPath(slug);
  return `${boardPath(slug)}?${WALL_CAPABILITY_PARAM}=${encodeURIComponent(wallCapability)}`;
}

/**
 * The gym console's link to a board's poster, or `null` when the board gets
 * none. The console holds the board row itself, so an unlisted Spraywall's
 * link carries its own uuid as the capability (a Spraywall's uuid is its board
 * uuid) — the same uuid its share link carries.
 */
export function boardPosterConsoleHref(board: BoardPosterBoard): string | null {
  // A board row without a slug has no `/b/{slug}` for a code to open.
  if (!board.slug) return null;
  const capability = board.boardType === SPRAY_BOARD_TYPE && !board.isPublic ? board.uuid : undefined;
  const target = boardPosterTarget(board, capability);
  if (!target) return null;
  return boardPosterHref(board.slug, { wallCapability: target.wallCapability });
}
