import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { spacing } from '../../theme/tokens';

/** The small text button under Home's sections, above the feed, that opens the Customize Home sheet. */
export const HomeCustomizeButton = memo(function HomeCustomizeButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation('common');
  return (
    <View style={styles.container}>
      <Button
        title={t('mobile.settings.homeSections.customize')}
        icon="view.options"
        variant="text"
        size="small"
        minHeight={44}
        onPress={onPress}
        // It sits in the list header and can mount scrolled out of view.
        ignoreContainerSafeArea
        testID="home-customize"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingBottom: spacing[3],
  },
});
