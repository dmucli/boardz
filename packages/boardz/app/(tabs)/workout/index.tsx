import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useBoard } from '../../../src/board/board-provider';
import { WORKOUTS } from '../../../src/workout/catalog';
import { summarizeRunner, workoutSteps } from '../../../src/workout/engine';
import { WORKOUT_ICONS } from '../../../src/workout/workout-icons';
import { useWorkout } from '../../../src/workout/workout-provider';
import { Button } from '../../../src/ui/Button';
import { Card, Section } from '../../../src/ui/Card';
import { Icon } from '../../../src/ui/Icon';
import { ChevronRight, Play } from '../../../src/ui/icons';
import { LedDot } from '../../../src/ui/LedDot';
import { PageHeader } from '../../../src/ui/PageHeader';
import { Screen } from '../../../src/ui/Screen';
import { Text } from '../../../src/ui/Text';
import { LED, useTheme } from '../../../src/ui/theme';
import { radius, spacing } from '../../../src/ui/tokens';

function ActiveWorkoutCard() {
  const { workout, end } = useWorkout();
  if (!workout) return null;

  let progress = 'Free climbing';
  if (workout.runner && workout.timing) {
    const steps = workoutSteps({ timing: workout.timing, climbCount: workout.climbs.length });
    const summary = summarizeRunner(workout.runner);
    const phase = workout.runner.phase;
    const current = phase.kind === 'climbing' ? phase.stepIndex : phase.kind === 'resting' ? phase.nextStepIndex : null;
    progress =
      current === null
        ? `Finished · ${summary.sent} of ${steps.length} sent`
        : `Climb ${current + 1} of ${steps.length} · ${summary.sent} sent`;
  }

  const confirmEnd = () =>
    Alert.alert('End this workout?', 'Climbs you logged stay in your logbook.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'End workout', style: 'destructive', onPress: end },
    ]);

  return (
    <Section
      title="In progress"
      right={
        <View style={styles.live}>
          <LedDot color={LED.green} pulse />
          <Text variant="label" tone="secondary">
            Live
          </Text>
        </View>
      }
    >
      <View style={styles.activeCopy}>
        <Text variant="title3">{workout.title}</Text>
        <Text variant="mono" tone="tertiary">
          {progress}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Resume" size="lg" icon={Play} style={styles.flex} onPress={() => router.push('/workout-run')} />
        <Button title="End" variant="danger" size="lg" onPress={confirmEnd} />
      </View>
    </Section>
  );
}

export default function WorkoutScreen() {
  const theme = useTheme();
  const { board } = useBoard();

  return (
    <Screen
      header={
        <PageHeader
          title="Workouts"
          meta={board ? `${WORKOUTS.length} plans · ${board.name}` : `${WORKOUTS.length} plans`}
        />
      }
    >
      <ActiveWorkoutCard />
      {board ? null : (
        <Text variant="small" tone="tertiary" style={styles.intro}>
          Set up your board on Home first, so Boardz can pick climbs that fit it.
        </Text>
      )}
      <Card flush>
        {WORKOUTS.map((workout, index) => (
          <Pressable
            key={workout.kind}
            accessibilityRole="button"
            accessibilityLabel={workout.name}
            onPress={() => router.push({ pathname: '/workout/[kind]', params: { kind: workout.kind } })}
            style={({ pressed }) => [
              styles.row,
              index < WORKOUTS.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border1 },
              { backgroundColor: pressed ? theme.bgSurface2 : 'transparent' },
            ]}
          >
            <View style={[styles.tile, { backgroundColor: theme.bgSurface3 }]}>
              <Icon icon={WORKOUT_ICONS[workout.kind]} size={16} color={theme.fg1} />
            </View>
            <Text variant="bodyStrong" style={styles.flex}>
              {workout.name}
            </Text>
            <Icon icon={ChevronRight} size={16} color={theme.fg3} />
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { paddingHorizontal: spacing.xxs },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeCopy: { gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  tile: { width: 32, height: 32, borderRadius: radius.tag, alignItems: 'center', justifyContent: 'center' },
});
