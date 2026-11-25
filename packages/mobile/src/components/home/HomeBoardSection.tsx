import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardSummaryCard } from '../boards/BoardSummaryCard';
import { useBoardShortcutNavigation } from '../../lib/boards/use-board-shortcut-navigation';
import { HomeSectionFrame } from './HomeSectionFrame';

/**
 * "Your board": the board you're on, to browse its climbs or change it. The
 * Session tab's card, reading the stored board, so it works with no signal.
 * A change comes back to Home; a first pick lands on Climbs.
 */
export const HomeBoardSection = memo(function HomeBoardSection() {
  const { t } = useTranslation('common');
  const { boardQuery, hasNoBoard, browseClimbs, openBoardSwitcher, retryBoard } =
    useBoardShortcutNavigation('/(tabs)/home');
  const activeBoard = boardQuery.data;
  return (
    <HomeSectionFrame title={t('mobile.settings.homeSections.sections.board')} testID="home-section-board">
      <BoardSummaryCard
        board={activeBoard}
        hasNoBoard={hasNoBoard}
        isRestoreError={!activeBoard && boardQuery.isError}
        onBrowseClimbs={browseClimbs}
        onChangeBoard={openBoardSwitcher}
        onRetry={retryBoard}
      />
    </HomeSectionFrame>
  );
});
