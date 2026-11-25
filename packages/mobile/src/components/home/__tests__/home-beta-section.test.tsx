// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

type Video = {
  climbName: string | null;
  boardType: string;
  layoutId: number | null;
  betaLink: { link: string; climb_uuid: string | null; angle: number | null };
};

const state = vi.hoisted(() => ({
  calls: [] as Array<[number, string | null, number | null, boolean]>,
  query: {
    data: undefined as Video[] | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  offline: { isBlocked: false, reason: null as string | null },
}));
const openClimb = vi.hoisted(() => vi.fn());
type ItemLayout = { length: number; offset: number; index: number };
const list = vi.hoisted(() => ({
  getItemLayout: null as ((data: unknown, index: number) => ItemLayout) | null,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  DynamicColorIOS: (appearances: { light: string }) => appearances.light,
  PlatformColor: (name: string) => name,
  View: ({ children, testID }: { children?: ReactNode; testID?: string }) =>
    createElement('div', { 'data-testid': testID }, children),
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
    getItemLayout,
  }: {
    data: Video[];
    renderItem: (entry: { item: Video; index: number }) => ReactNode;
    keyExtractor: (item: Video) => string;
    getItemLayout: (data: unknown, index: number) => ItemLayout;
  }) => {
    list.getItemLayout = getItemLayout;
    return createElement(
      'ul',
      { 'data-testid': 'beta-list' },
      ...data.map((item, index) => createElement('li', { key: keyExtractor(item) }, renderItem({ item, index }))),
    );
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));
vi.mock('@boardsesh/shared-schema', () => ({ betaLinkIdentity: (link: string) => link }));
vi.mock('../../Button', () => ({
  Button: ({ title, onPress }: { title: string; onPress: () => void }) =>
    createElement('button', { onClick: onPress }, title),
}));
vi.mock('../../Icon', () => ({ Icon: ({ name }: { name: string }) => createElement('i', { 'data-icon': name }) }));
vi.mock('../../Text', () => ({ Text: ({ children }: { children?: ReactNode }) => createElement('p', null, children) }));
vi.mock('../../PressableSurface', () => ({
  PressableSurface: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
}));
vi.mock('../../play-drawer/BetaVideoCard', () => ({
  BETA_CARD_WIDTH: 108,
  BETA_CARD_HEIGHT: 192,
  BetaVideoCard: ({ link }: { link: { link: string } }) => createElement('a', { href: link.link }, 'video'),
}));
vi.mock('../../../lib/routing/scoped-navigation', () => ({ useScopedRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../lib/graphql/hooks', () => ({
  useRecentBetaLinks: (limit: number, boardType: string | null, layoutId: number | null, enabled: boolean) => {
    state.calls.push([limit, boardType, layoutId, enabled]);
    return state.query;
  },
}));
vi.mock('../../../lib/open-climb-in-play-drawer', () => ({ openClimbInPlayDrawer: openClimb }));
vi.mock('../../../lib/haptics', () => ({ hapticLight: vi.fn() }));
vi.mock('../../../hooks/use-offline-query-state', () => ({ useOfflineQueryState: () => state.offline }));
vi.mock('../../../providers/drawer-host-provider', () => ({ useDrawerHost: () => ({ openPlayDrawer: vi.fn() }) }));
vi.mock('../../../providers/theme-provider', () => ({ useTheme: () => ({ systemColors: {} }) }));

import { HomeBetaSection } from '../HomeBetaSection';

const VIDEO: Video = {
  climbName: 'Slab Dog',
  boardType: 'kilter',
  layoutId: 1,
  betaLink: { link: 'https://www.instagram.com/p/abc', climb_uuid: 'climb-1', angle: 40 },
};

beforeEach(() => {
  state.calls = [];
  state.query = { data: undefined, isPending: false, isError: false, refetch: vi.fn() };
  state.offline = { isBlocked: false, reason: null };
  openClimb.mockClear();
  list.getItemLayout = null;
});

afterEach(() => {
  cleanup();
});

describe('HomeBetaSection', () => {
  it("asks for one page of the selected board's layout, and says so in its title", () => {
    state.query.data = [VIDEO];
    render(createElement(HomeBetaSection, { boardType: 'kilter', layoutId: 1, enabled: true }));
    expect(state.calls.at(-1)).toEqual([20, 'kilter', 1, true]);
    expect(screen.getByText('mobile.home.sections.beta.titleBoard')).toBeTruthy();
    expect(screen.getByTestId('beta-list').children).toHaveLength(1);
  });

  it('is every board, with the plain title, when Home has no board', () => {
    state.query.data = [VIDEO];
    render(createElement(HomeBetaSection, { boardType: null, layoutId: null, enabled: true }));
    expect(state.calls.at(-1)).toEqual([20, null, null, true]);
    expect(screen.getByText('mobile.home.sections.beta.title')).toBeTruthy();
  });

  it('places each card after the shelf inset, one card and gap apart', () => {
    state.query.data = [VIDEO];
    render(createElement(HomeBetaSection, { boardType: 'kilter', layoutId: 1, enabled: true }));
    const getItemLayout = list.getItemLayout;
    if (!getItemLayout) throw new Error('the shelf gave no item layout');
    // 16 of inset, then 108 of card and 12 of gap per step.
    expect(getItemLayout(null, 0)).toEqual({ length: 120, offset: 16, index: 0 });
    expect(getItemLayout(null, 2)).toEqual({ length: 120, offset: 256, index: 2 });
  });

  it('opens the climb under a card in the player', () => {
    state.query.data = [VIDEO];
    render(createElement(HomeBetaSection, { boardType: 'kilter', layoutId: 1, enabled: true }));
    fireEvent.click(screen.getByRole('button', { name: 'mobile.home.sections.beta.openClimb {"climb":"Slab Dog"}' }));
    expect(openClimb).toHaveBeenCalledWith(
      { kind: 'ref', climbUuid: 'climb-1', boardType: 'kilter', layoutId: 1, angle: 40 },
      expect.anything(),
    );
  });

  it('holds a skeleton, and asks for nothing, until the scope settles', () => {
    state.query.isPending = true;
    render(createElement(HomeBetaSection, { boardType: null, layoutId: null, enabled: false }));
    expect(state.calls.at(-1)?.[3]).toBe(false);
    expect(screen.queryByTestId('beta-list')).toBeNull();
  });

  it('says there is no signal instead of a list, offline', () => {
    state.offline = { isBlocked: true, reason: 'offline' };
    render(createElement(HomeBetaSection, { boardType: null, layoutId: null, enabled: true }));
    expect(screen.getByText('mobile.home.sections.beta.offline')).toBeTruthy();
    expect(screen.queryByText('actions.retry')).toBeNull();
  });

  it('offers Retry when the server fails, and an empty line when there is nothing', () => {
    state.query.isError = true;
    const { unmount } = render(createElement(HomeBetaSection, { boardType: null, layoutId: null, enabled: true }));
    expect(screen.getByText('mobile.home.sections.beta.error')).toBeTruthy();
    fireEvent.click(screen.getByText('actions.retry'));
    expect(state.query.refetch).toHaveBeenCalledTimes(1);
    unmount();
    state.query = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    render(createElement(HomeBetaSection, { boardType: null, layoutId: null, enabled: true }));
    expect(screen.getByText('mobile.home.sections.beta.empty')).toBeTruthy();
  });
});
