import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGradesForBoard } from '@boardsesh/board-config';
import { describeRequestError } from '../../../src/api/graphql-client';
import { useAuth } from '../../../src/auth/auth-provider';
import { toSearchConfig } from '../../../src/board/active-board';
import { useBoard } from '../../../src/board/board-provider';
import { climbQuality } from '../../../src/climbs/ClimbRow';
import { useClimbSequence } from '../../../src/climbs/climb-sequence';
import { gradeBand, gradeLabel, gradeOptions, type GradeOption } from '../../../src/grades/grades';
import { useSession } from '../../../src/session/session-provider';
import { usePreferences } from '../../../src/settings/preferences-provider';
import { WORKOUTS, type WorkoutKind } from '../../../src/workout/catalog';
import { fetchGradePool, fetchGradeRange, type GradePool } from '../../../src/workout/fetch-pools';
import { formatSeconds, formatSecondsShort } from '../../../src/workout/format';
import { pickClimbs, swapClimb, type PlannedClimb } from '../../../src/workout/pick-climbs';
import {
  defaultConfig,
  estimateMinutes,
  plannedGrades,
  usesField,
  workoutTiming,
  workoutTitle,
  type WorkoutConfig,
} from '../../../src/workout/workout-config';
import { useWorkout } from '../../../src/workout/workout-provider';
import { Button } from '../../../src/ui/Button';
import { Card, Section } from '../../../src/ui/Card';
import { GradeBadge } from '../../../src/ui/GradeBadge';
import { IconButton } from '../../../src/ui/IconButton';
import { Play, RefreshCw, Shuffle } from '../../../src/ui/icons';
import { SegmentedControl } from '../../../src/ui/SegmentedControl';
import { Stepper } from '../../../src/ui/Stepper';
import { Switch } from '../../../src/ui/Switch';
import { Text } from '../../../src/ui/Text';
import { TopBar } from '../../../src/ui/TopBar';
import { useTheme } from '../../../src/ui/theme';
import { GUTTER, spacing } from '../../../src/ui/tokens';

type NumericField =
  | 'climbs'
  | 'steps'
  | 'climbsPerStep'
  | 'spread'
  | 'restSeconds'
  | 'intervalSeconds'
  | 'rounds'
  | 'restBetweenClimbsSeconds'
  | 'restBetweenRoundsSeconds';

const NUMERIC_FIELDS: NumericField[] = [
  'climbs',
  'steps',
  'climbsPerStep',
  'spread',
  'intervalSeconds',
  'rounds',
  'restSeconds',
  'restBetweenClimbsSeconds',
  'restBetweenRoundsSeconds',
];

type FieldSpec = {
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  spoken?: (value: number) => string;
};

/** Durations show as mono figures and are spoken in words. */
const DURATION = { format: formatSecondsShort, spoken: formatSeconds };

function numericSpec(kind: WorkoutKind, field: NumericField): FieldSpec {
  switch (field) {
    case 'climbs':
      return kind === 'limitBouldering'
        ? { label: 'Problems', min: 1, max: 8, step: 1, format: String }
        : { label: 'Climbs', min: 1, max: 40, step: 1, format: String };
    case 'steps':
      return { label: kind === 'pyramid' ? 'Steps up and down' : 'Steps up', min: 2, max: 9, step: 1, format: String };
    case 'climbsPerStep':
      return { label: 'Climbs per step', min: 1, max: 4, step: 1, format: String };
    case 'spread':
      return { label: 'Grade spread', min: 0, max: 3, step: 1, format: (value) => (value === 0 ? '0' : `±${value}`) };
    case 'restSeconds':
      return kind === 'limitBouldering'
        ? { label: 'Rest after each go', min: 60, max: 600, step: 30, ...DURATION }
        : { label: 'Rest after each climb', min: 0, max: 600, step: 15, ...DURATION };
    case 'intervalSeconds':
      return { label: 'Time per climb', min: 30, max: 240, step: 15, ...DURATION };
    case 'rounds':
      return { label: 'Rounds', min: 1, max: 8, step: 1, format: String };
    case 'restBetweenClimbsSeconds':
      return { label: 'Rest between climbs', min: 0, max: 120, step: 15, ...DURATION };
    case 'restBetweenRoundsSeconds':
      return { label: 'Rest between rounds', min: 60, max: 600, step: 30, ...DURATION };
  }
}

function gradeFieldLabel(kind: WorkoutKind): string {
  switch (kind) {
    case 'pyramid':
    case 'ladder':
      return 'Top grade';
    case 'warmUp':
      return 'Warm up for';
    case 'volume':
      return 'Around';
    default:
      return 'Grade';
  }
}

// 6B (V4) when there is nothing better to go on.
const FALLBACK_GRADE = 18;

function initialGrade(grades: GradeOption[], remembered: number | null): number {
  const available = new Set(grades.map((grade) => grade.difficultyId));
  if (remembered !== null && available.has(remembered)) return remembered;
  if (available.has(FALLBACK_GRADE)) return FALLBACK_GRADE;
  return grades[Math.floor(grades.length / 2)]?.difficultyId ?? FALLBACK_GRADE;
}

type Preview = { planned: PlannedClimb[]; missing: number; pools: Map<number, GradePool> };

// Settings changes rebuild the plan after this pause, so stepping through
// values doesn't search for each one.
const BUILD_DELAY_MS = 250;

/** The usable grade closest to `grade`, so a remembered grade the board lacks still works. */
function nearestGrade(grade: number, usable: readonly GradeOption[]): number {
  let best = usable[0]?.difficultyId ?? grade;
  for (const option of usable) {
    if (Math.abs(option.difficultyId - grade) < Math.abs(best - grade)) best = option.difficultyId;
  }
  return best;
}

export default function WorkoutSetupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind: string }>();
  const definition = WORKOUTS.find((workout) => workout.kind === params.kind);
  const { board } = useBoard();
  const { status, profile } = useAuth();
  const queryClient = useQueryClient();
  const { gradeFormat, workoutGrade, update } = usePreferences();
  const workoutContext = useWorkout();
  const session = useSession();
  const { setClimbs } = useClimbSequence();
  const boardGrades = board ? gradeOptions(board.boardName, gradeFormat) : [];

  const [config, setConfig] = useState<WorkoutConfig | null>(() =>
    definition ? defaultConfig(definition.kind, initialGrade(boardGrades, workoutGrade)) : null,
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [shuffleCount, setShuffleCount] = useState(0);

  const isFree = config?.kind === 'freeClimbing';
  const signedIn = status === 'signedIn';
  const searchConfig = board ? toSearchConfig(board) : null;
  const filters = {
    benchmarksOnly: config?.benchmarksOnly ?? false,
    unsentFirst: (config?.freshClimbsOnly ?? false) && signedIn,
  };

  // Only grades with workout climbs on this board can be picked or planned.
  const range = useQuery({
    queryKey: ['workoutGradeRange', searchConfig, filters.benchmarksOnly],
    queryFn: () => (board ? fetchGradeRange(board, filters) : null),
    enabled: board !== null && config !== null && !isFree,
    staleTime: 30 * 60_000,
  });
  const gradeRange = range.data ?? null;
  const usableGrades = gradeRange
    ? boardGrades.filter((grade) => grade.difficultyId >= gradeRange.lowest && grade.difficultyId <= gradeRange.highest)
    : boardGrades;
  const targetGrade = config ? nearestGrade(config.targetGrade, usableGrades) : null;

  // Rebuild the plan when something that picks climbs changes. Rest and timer
  // settings don't, and each grade's climbs are cached, so a shuffle, or a
  // grade the plan already had, needs no search.
  const planKey = JSON.stringify([
    config && {
      ...config,
      restSeconds: 0,
      intervalSeconds: 0,
      restBetweenClimbsSeconds: 0,
      restBetweenRoundsSeconds: 0,
      goalMinutes: 0,
      rounds: 0,
    },
    targetGrade,
    searchConfig,
    filters,
    profile?.id ?? null,
    gradeRange,
    shuffleCount,
  ]);
  useEffect(() => {
    if (!board || !config || isFree || !gradeRange || targetGrade === null) return;
    let cancelled = false;
    setBuilding(true);
    setBuildError(null);
    const scale = getGradesForBoard(board.boardName).filter(
      (grade) => grade.difficulty_id >= gradeRange.lowest && grade.difficulty_id <= gradeRange.highest,
    );
    const timer = setTimeout(() => {
      const planned = plannedGrades({ ...config, targetGrade }, scale);
      Promise.all(
        [...new Set(planned)].map(async (grade) => {
          const pool = await queryClient.fetchQuery({
            queryKey: ['workoutPool', searchConfig, grade, filters, profile?.id ?? null],
            queryFn: () => fetchGradePool(board, grade, filters),
            staleTime: 10 * 60_000,
          });
          return [grade, pool] as const;
        }),
      )
        .then((entries) => {
          if (cancelled) return;
          const pools = new Map(entries);
          setPreview({ ...pickClimbs(planned, pools), pools });
        })
        .catch((error: unknown) => {
          if (!cancelled) setBuildError(describeRequestError(error));
        })
        .finally(() => {
          if (!cancelled) setBuilding(false);
        });
    }, BUILD_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [planKey]);

  if (!definition || !config) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.bgApp }]}>
        <TopBar />
        <View style={styles.center}>
          <Text tone="tertiary">This workout doesn&apos;t exist.</Text>
        </View>
      </View>
    );
  }

  const change = (changes: Partial<WorkoutConfig>) => setConfig({ ...config, ...changes });
  const gradeIndex = Math.max(
    0,
    usableGrades.findIndex((grade) => grade.difficultyId === targetGrade),
  );
  const targetLabel = usableGrades[gradeIndex]?.label ?? '';
  const planned = preview?.planned ?? [];
  const loading = building || range.isFetching;
  const noClimbs = range.isSuccess && range.data === null;
  // A failed or empty grade lookup leaves the last plan on screen; it mustn't start.
  const canStart = board !== null && (isFree || (planned.length > 0 && !loading && !noClimbs && !range.isError));
  const startLabel = definition.name === '4x4' ? 'Start 4x4' : `Start ${definition.name.toLowerCase()}`;

  const start = () => {
    const begin = () => {
      workoutContext.start({
        kind: config.kind,
        title: workoutTitle(config, targetLabel),
        climbs: planned.map((entry) => entry.climb),
        timing: workoutTiming(config),
        goalMinutes: isFree ? config.goalMinutes : null,
      });
      session.start();
      if (!isFree && targetGrade !== null) update({ workoutGrade: targetGrade });
      router.push('/workout-run');
    };
    if (workoutContext.workout) {
      Alert.alert('Replace your workout?', `${workoutContext.workout.title} is still in progress.`, [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Start new', style: 'destructive', onPress: begin },
      ]);
    } else {
      begin();
    }
  };

  const openPreviewClimb = (index: number) => {
    setClimbs(planned.map((entry) => entry.climb));
    router.push({ pathname: '/climb/[uuid]', params: { uuid: planned[index].climb.uuid } });
  };

  const numericFields = NUMERIC_FIELDS.filter((field) => usesField(config.kind, field));
  const climbCount =
    config.kind === 'fourByFour'
      ? `${planned.length} climbs × ${config.rounds} rounds`
      : `${planned.length} ${planned.length === 1 ? 'climb' : 'climbs'}`;
  const summary = preview && !noClimbs ? `${climbCount} · about ${estimateMinutes(config, planned.length)} min` : '';
  const error = buildError ?? (range.error ? describeRequestError(range.error) : null);
  const retry = () => {
    if (range.isError) void range.refetch();
    else setShuffleCount(shuffleCount + 1);
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.bgApp }]}>
      <TopBar label={`Workout · ${definition.name}`} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="title1" style={styles.title}>
          {definition.name}
        </Text>

        {!board ? (
          <Section>
            <Text>Set up your board first, so Boardz can pick climbs that are on it.</Text>
            <Button title="Set up board" onPress={() => router.push('/board-setup')} />
          </Section>
        ) : (
          <>
            <Section>
              {!isFree ? (
                <Stepper
                  label={gradeFieldLabel(config.kind)}
                  showLabel
                  value={gradeIndex}
                  min={0}
                  max={Math.max(0, usableGrades.length - 1)}
                  format={(index) => usableGrades[index]?.label ?? ''}
                  onChange={(index) => change({ targetGrade: usableGrades[index].difficultyId })}
                />
              ) : null}
              {numericFields.map((field) => {
                const spec = numericSpec(config.kind, field);
                return (
                  <Stepper
                    key={field}
                    label={spec.label}
                    showLabel
                    value={config[field]}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    format={spec.format}
                    spokenFormat={spec.spoken}
                    onChange={(value) => change({ [field]: value })}
                  />
                );
              })}
              {usesField(config.kind, 'warmUpLength') ? (
                <View style={styles.field}>
                  <Text variant="label">Length</Text>
                  <SegmentedControl
                    fullWidth
                    size="lg"
                    value={config.warmUpLength}
                    onChange={(warmUpLength) => change({ warmUpLength })}
                    options={[
                      { value: 'standard', label: 'Short · 4' },
                      { value: 'extended', label: 'Long · 12' },
                    ]}
                  />
                </View>
              ) : null}
              {isFree ? (
                <Stepper
                  label="Goal"
                  showLabel
                  value={config.goalMinutes ?? 0}
                  min={0}
                  max={240}
                  step={15}
                  format={(minutes) => (minutes === 0 ? 'Open' : `${minutes}m`)}
                  onChange={(minutes) => change({ goalMinutes: minutes === 0 ? null : minutes })}
                />
              ) : null}
              {usesField(config.kind, 'warmUp') ? (
                <Switch label="Warm up first" value={config.warmUp} onValueChange={(warmUp) => change({ warmUp })} />
              ) : null}
              {usesField(config.kind, 'benchmarksOnly') ? (
                <Switch
                  label="Benchmarks only"
                  value={config.benchmarksOnly}
                  onValueChange={(benchmarksOnly) => change({ benchmarksOnly })}
                />
              ) : null}
              {usesField(config.kind, 'freshClimbsOnly') ? (
                <Switch
                  label="Hide what I've sent"
                  description={signedIn ? undefined : 'Sign in to use this'}
                  value={config.freshClimbsOnly && signedIn}
                  disabled={!signedIn}
                  onValueChange={(freshClimbsOnly) => change({ freshClimbsOnly })}
                />
              ) : null}
            </Section>

            {isFree ? null : (
              <View style={styles.previewBlock}>
                <View style={styles.previewHeader}>
                  <Text variant="mono" tone="secondary" style={styles.flex}>
                    {summary}
                  </Text>
                  <Button
                    title="Shuffle"
                    variant="ghost"
                    size="sm"
                    icon={Shuffle}
                    disabled={loading || !preview}
                    onPress={() => setShuffleCount(shuffleCount + 1)}
                  />
                </View>
                {noClimbs ? <Text tone="tertiary">No climbs fit these settings.</Text> : null}
                {preview && preview.missing > 0 && !noClimbs ? (
                  <Text variant="small" tone="tertiary">
                    Found {planned.length} of {planned.length + preview.missing} climbs.
                  </Text>
                ) : null}
                {error ? (
                  <Section>
                    <Text tone="danger">{error}</Text>
                    <Button title="Try again" variant="secondary" onPress={retry} />
                  </Section>
                ) : null}
                {preview && !noClimbs ? (
                  <Card flush style={loading ? styles.stale : undefined}>
                    {planned.map((entry, index) => {
                      const quality = climbQuality(entry.climb);
                      return (
                        <View
                          key={`${index}-${entry.climb.uuid}`}
                          style={[
                            styles.previewRow,
                            index < planned.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border1 },
                          ]}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Climb ${index + 1}: ${entry.climb.name}`}
                            accessibilityHint="Shows the climb"
                            onPress={() => openPreviewClimb(index)}
                            style={styles.previewMain}
                          >
                            <Text variant="mono" tone="tertiary" style={styles.index}>
                              {String(index + 1).padStart(2, '0')}
                            </Text>
                            <View style={styles.previewCopy}>
                              <Text variant="bodyStrong" numberOfLines={1}>
                                {entry.climb.name}
                              </Text>
                              <View style={styles.meta}>
                                <Text variant="mono" tone="tertiary">
                                  {entry.climb.ascensionist_count.toLocaleString()}
                                </Text>
                                {quality ? (
                                  <Text variant="mono" tone="tertiary">
                                    ★{quality}
                                  </Text>
                                ) : null}
                              </View>
                            </View>
                            <GradeBadge
                              label={gradeLabel(entry.climb.difficulty, gradeFormat)}
                              band={gradeBand(entry.climb.difficulty)}
                              benchmark={entry.climb.benchmark_difficulty != null}
                              fixedWidth
                            />
                          </Pressable>
                          <IconButton
                            icon={RefreshCw}
                            label={`Swap ${entry.climb.name} for another climb at this grade`}
                            size="sm"
                            onPress={() =>
                              setPreview({ ...preview, planned: swapClimb(planned, index, preview.pools) })
                            }
                          />
                        </View>
                      );
                    })}
                  </Card>
                ) : loading ? (
                  <ActivityIndicator style={styles.loading} />
                ) : null}
              </View>
            )}
          </>
        )}
      </ScrollView>
      {board ? (
        <View
          style={[
            styles.actions,
            { borderTopColor: theme.border2, backgroundColor: theme.bgApp, paddingBottom: spacing.md + insets.bottom },
          ]}
        >
          <Button title={startLabel} size="lg" icon={Play} fullWidth disabled={!canStart} onPress={start} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: GUTTER, paddingBottom: spacing.xxl, gap: spacing.md },
  title: { paddingBottom: spacing.xs },
  field: { gap: spacing.sm },
  previewBlock: { gap: spacing.sm, marginTop: spacing.xs },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.xxs },
  stale: { opacity: 0.5 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingRight: spacing.sm },
  previewMain: {
    flex: 1,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: spacing.lg,
  },
  index: { width: 22 },
  previewCopy: { flex: 1, minWidth: 0, gap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  loading: { paddingVertical: spacing.xl },
  actions: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1 },
});
