import { memo, useMemo } from 'react';
import { View } from 'react-native';
import {
  SectionLayoutSheetFooter,
  SectionLayoutSheetFrame,
  SectionLayoutSheetIntro,
  SectionLayoutSheetList,
  sectionLayoutSheetStyles,
  type SectionLayoutSheetAction,
} from '../section-layout/SectionLayoutSheet';
import { useHomeSectionControls } from './use-home-section-controls';

/**
 * Customize Home: a switch per section, ↑/↓ arrows for the ones above the feed,
 * Show all and Focused at the top, Restore defaults under the list. Choices
 * apply at once; Home redraws behind the sheet.
 */
export const HomeCustomizeSheet = memo(function HomeCustomizeSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const {
    customizeLabel,
    description,
    footer,
    rows,
    onVisibleChange,
    onMove,
    showAllLabel,
    focusedLabel,
    restoreDefaultsLabel,
    showAll,
    applyFocused,
    restoreDefaults,
    canShowAll,
    canApplyFocused,
    canRestoreDefaults,
  } = useHomeSectionControls();
  const actions = useMemo<[SectionLayoutSheetAction, SectionLayoutSheetAction]>(
    () => [
      { label: showAllLabel, onPress: showAll, disabled: !canShowAll, testID: 'home-customize-show-all' },
      { label: focusedLabel, onPress: applyFocused, disabled: !canApplyFocused, testID: 'home-customize-focused' },
    ],
    [showAllLabel, showAll, canShowAll, focusedLabel, applyFocused, canApplyFocused],
  );
  const restoreAction = useMemo<SectionLayoutSheetAction>(
    () => ({
      label: restoreDefaultsLabel,
      onPress: restoreDefaults,
      disabled: !canRestoreDefaults,
      testID: 'home-customize-restore-defaults',
    }),
    [restoreDefaultsLabel, restoreDefaults, canRestoreDefaults],
  );
  // In the list, not pinned: at the largest text on a small phone a pinned
  // description and actions would fill the sheet and leave no room for a switch.
  const listIntro = useMemo(
    () => (
      <View style={sectionLayoutSheetStyles.listIntro}>
        <SectionLayoutSheetIntro description={description} actions={actions} />
      </View>
    ),
    [description, actions],
  );
  const listFooter = useMemo(
    () => <SectionLayoutSheetFooter guidance={footer} restoreDefaults={restoreAction} />,
    [footer, restoreAction],
  );
  return (
    <SectionLayoutSheetFrame visible={visible} onClose={onClose} title={customizeLabel}>
      <SectionLayoutSheetList
        rows={rows}
        onVisibleChange={onVisibleChange}
        onMove={onMove}
        ListHeaderComponent={listIntro}
        ListFooterComponent={listFooter}
      />
    </SectionLayoutSheetFrame>
  );
});
