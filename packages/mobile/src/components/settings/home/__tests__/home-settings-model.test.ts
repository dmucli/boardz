import { describe, expect, it, vi } from 'vitest';
import { buildHomeSettingsModel, type HomeSettingsModelInput } from '../home-settings-model';
import type { MoreRow } from '../../../MoreForm.types';

const echo = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);

function makeInput(overrides: Partial<HomeSettingsModelInput> = {}): HomeSettingsModelInput {
  return {
    t: echo,
    startupScreen: 'climbs',
    onStartupScreenChange: vi.fn(),
    movableSections: { kind: 'hosted', content: 'movable rows', height: 340 },
    fixedRows: [{ id: 'feed', label: 'Feed', description: 'Always last', visible: true, movable: false }],
    onSectionChange: vi.fn(),
    canShowAll: true,
    onShowAll: vi.fn(),
    canApplyFocused: true,
    onApplyFocused: vi.fn(),
    canRestoreDefaults: false,
    onRestoreDefaults: vi.fn(),
    ...overrides,
  };
}

function findRow(input: HomeSettingsModelInput, key: string): MoreRow {
  const row = buildHomeSettingsModel(input)
    .sections.flatMap((section) => section.rows)
    .find((candidate) => candidate.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
}

describe('buildHomeSettingsModel', () => {
  it('runs the start-up tab first, then the sections, the feed, then the presets', () => {
    expect(buildHomeSettingsModel(makeInput()).sections.map((section) => section.key)).toEqual([
      'startup',
      'sections',
      'fixedSections',
      'presets',
    ]);
  });

  describe('the start-up tab', () => {
    it('offers Climbs then Home under the tab names, with Climbs chosen by default', () => {
      const row = findRow(makeInput(), 'startupScreen');
      if (row.kind !== 'segmented') throw new Error('startupScreen is not a segmented row');
      expect(row.options).toEqual([
        { key: 'climbs', label: 'mobile.nav.climbs' },
        { key: 'home', label: 'mobile.nav.home' },
      ]);
      expect(row.selectedKey).toBe('climbs');
      expect(row.label).toBe('mobile.settings.startup.title');
    });

    it('shows a stored Home choice', () => {
      const row = findRow(makeInput({ startupScreen: 'home' }), 'startupScreen');
      if (row.kind !== 'segmented') throw new Error('startupScreen is not a segmented row');
      expect(row.selectedKey).toBe('home');
    });

    it('says when it applies and what still opens elsewhere', () => {
      const section = buildHomeSettingsModel(makeInput()).sections.find((candidate) => candidate.key === 'startup');
      expect(section?.title).toBe('mobile.settings.startup.title');
      expect(section?.footer).toBe('mobile.settings.startup.footer');
    });

    it('saves known tabs only', () => {
      const onStartupScreenChange = vi.fn();
      const row = findRow(makeInput({ onStartupScreenChange }), 'startupScreen');
      if (row.kind !== 'segmented') throw new Error('startupScreen is not a segmented row');
      row.onSelect('home');
      row.onSelect('profile');
      expect(onStartupScreenChange).toHaveBeenCalledTimes(1);
      expect(onStartupScreenChange).toHaveBeenCalledWith('home');
    });
  });

  it('hosts the movable sections as one full-bleed row at their drawn height, the feed as a switch', () => {
    const onSectionChange = vi.fn();
    const model = buildHomeSettingsModel(makeInput({ onSectionChange }));
    const [, sections, fixed, presets] = model.sections;
    expect(sections.title).toBe('mobile.settings.homeSections.groupTitle');
    expect(sections.rows).toEqual([
      { kind: 'custom', key: 'movableSections', content: 'movable rows', height: 340, fullBleed: true },
    ]);
    expect(fixed.footer).toBe('mobile.settings.homeSections.settingsFooter');
    expect(fixed.rows.map((row) => row.key)).toEqual(['feed']);
    const feed = fixed.rows[0];
    if (feed.kind !== 'toggle') throw new Error('feed is not a toggle');
    expect(feed.subtitle).toBe('Always last');
    feed.onValueChange(false);
    expect(onSectionChange).toHaveBeenCalledWith('feed', false);
    expect(presets.rows.map((row) => [row.key, row.kind === 'button' ? row.disabled : null])).toEqual([
      ['showAll', false],
      ['focused', false],
      ['restoreDefaults', true],
    ]);
  });

  it('draws the movable sections as native switches with move buttons, disabled at the ends, on the native branch', () => {
    const onSectionChange = vi.fn();
    const onMove = vi.fn();
    const placed = {
      first: false,
      last: false,
      gapAbove: false,
      movableCount: 2,
    };
    const playlists = {
      ...placed,
      id: 'playlists' as const,
      label: 'Playlists',
      description: 'Liked and Projects',
      visible: false,
      movable: true,
      first: true,
      position: 1,
      canMoveUp: false,
      canMoveDown: true,
    };
    const board = {
      ...placed,
      id: 'board' as const,
      label: 'Your board',
      description: 'Browse or change it',
      visible: true,
      movable: true,
      last: true,
      position: 2,
      canMoveUp: true,
      canMoveDown: false,
    };
    const model = buildHomeSettingsModel(
      makeInput({ onSectionChange, movableSections: { kind: 'native', rows: [playlists, board], onMove } }),
    );
    const sections = model.sections[1];
    expect(sections.rows.map((row) => [row.kind, row.key])).toEqual([
      ['toggle', 'playlists'],
      ['toggle', 'board'],
    ]);
    const [playlistsRow, boardRow] = sections.rows;
    if (playlistsRow.kind !== 'toggle' || boardRow.kind !== 'toggle') throw new Error('sections are not toggles');
    expect(playlistsRow.value).toBe(false);
    expect(playlistsRow.subtitle).toBe('Liked and Projects');
    playlistsRow.onValueChange(true);
    expect(onSectionChange).toHaveBeenCalledWith('playlists', true);
    // Up then down, each named for TalkBack, dead at the ends of the list.
    expect(playlistsRow.actions?.map((action) => [action.icon, action.accessibilityLabel, action.disabled])).toEqual([
      ['moveUp', 'mobile.settings.sectionLayout.moveUp {"section":"Playlists"}', true],
      ['moveDown', 'mobile.settings.sectionLayout.moveDown {"section":"Playlists"}', false],
    ]);
    expect(boardRow.actions?.map((action) => action.disabled)).toEqual([false, true]);
    playlistsRow.actions?.[1].onPress();
    boardRow.actions?.[0].onPress();
    expect(onMove.mock.calls).toEqual([
      [playlists, 1],
      [board, -1],
    ]);
  });

  it('never gives the feed move buttons: it stays last', () => {
    const fixed = buildHomeSettingsModel(makeInput()).sections[2].rows[0];
    expect(fixed.kind === 'toggle' ? fixed.actions : 'not a toggle').toBeUndefined();
  });
});
