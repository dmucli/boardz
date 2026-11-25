import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ Stack: Object.assign(() => null, { Screen: () => null }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../../src/hooks/use-native-root-header', () => ({ useNativeRootHeader: () => false }));
vi.mock('../../../../src/hooks/use-stack-screen-options', () => ({ useStackScreenOptions: () => ({}) }));
vi.mock('../../../../src/hooks/use-pop-to-top-on-tab-blur', () => ({ usePopToTopOnTabBlur: () => {} }));
vi.mock('../../../../src/components/navigation/NativeTabletContent', () => ({ NativeTabletContent: () => null }));
vi.mock('../../../../src/components/navigation/NativeTabContentInsetProbe', () => ({
  NativeTabContentInsetProbe: () => null,
}));
vi.mock('../../../../src/providers/board-art-visibility-provider', () => ({ BoardArtVisibilityProvider: () => null }));

import { unstable_settings } from '../_layout';

describe('Discover stack', () => {
  // A push from another tab with `withAnchor` (Home's Playlists card, the
  // account menu's My playlists) lands on top of this, so Back reaches Discover's
  // main page even when the tab was never opened this launch.
  it('anchors on its main page', () => {
    expect(unstable_settings).toEqual({ initialRouteName: 'index' });
  });
});
