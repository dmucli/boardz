import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import postgres from 'postgres';
import { getWorkerDatabaseUrl, setupWorkerDatabase } from './worker-db';

// The migrations are read off disk and run verbatim, so the assertions are
// about the shipped files. Everything runs in one transaction that is rolled
// back, which leaves the worker database exactly as the next file expects.
const drizzleDir = fileURLToPath(new URL('../../../db/drizzle/', import.meta.url));
const migration = (tag: string) => readFileSync(`${drizzleDir}${tag}.sql`, 'utf8');

// 0272 opens with the admin prerequisite check, which needs the separately
// owned helper the test superuser does not install. The statements after it
// create the trigger the cleanup drops.
const statementsAfterPrerequisite = (migrationSql: string) =>
  migrationSql.split('--> statement-breakpoint').slice(1).join('\n');

// What #6339's migrations left in production.
const SIX_THREE_THREE_NINE = [
  migration('0270_climb_reference_membership'),
  migration('0271_sync_deletions_stream'),
  statementsAfterPrerequisite(migration('0272_sync_deletions_cutoff_guard')),
  migration('0273_climb_membership_withdrawal_flag'),
];

const CLEANUP = [
  migration('0274_drop_sync_deletion_stream_triggers'),
  migration('0275_drop_sync_deletion_stream_columns'),
];

// Every column, index, user trigger and public function, one line each, so a
// before/after comparison catches anything the cleanup drops or misses.
const CATALOGUE = `
  SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable
         || ' ' || coalesce(column_default, '') AS item
  FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL
  SELECT 'index ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'trigger ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL
  SELECT 'function ' || procedure.oid::regprocedure::text
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
  ORDER BY 1
`;

class RollBack extends Error {}

describe('0274/0275 drop what #6339 left in the database', () => {
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await setupWorkerDatabase();
    client = postgres(getWorkerDatabaseUrl(), { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  async function inRolledBackTransaction(body: (transaction: postgres.TransactionSql) => Promise<void>) {
    try {
      await client.begin(async (transaction) => {
        await body(transaction);
        throw new RollBack();
      });
    } catch (error) {
      if (!(error instanceof RollBack)) throw error;
    }
  }

  const catalogue = async (transaction: postgres.TransactionSql) =>
    (await transaction.unsafe<{ item: string }[]>(CATALOGUE)).map((row) => row.item);

  it('removes exactly the eight objects 0270-0273 created, and nothing else', async () => {
    await inRolledBackTransaction(async (transaction) => {
      const before = await catalogue(transaction);

      for (const migrationSql of SIX_THREE_THREE_NINE) await transaction.unsafe(migrationSql);
      const installed = await catalogue(transaction);
      const added = installed.filter((item) => !before.includes(item));
      expect(installed.filter((item) => !added.includes(item))).toEqual(before);
      expect(added.map((item) => item.split(' ').slice(0, 2).join(' ')).sort()).toEqual(
        [
          'column sync_deletions.is_membership_withdrawal',
          'column sync_deletions.stream_at',
          'function stamp_sync_deletion_stream_at()',
          'function sync_board_climb_reference_membership()',
          'index sync_deletions_null_stream_idx',
          'index sync_deletions_user_stream_idx',
          'trigger board_climbs',
          'trigger sync_deletions',
        ].sort(),
      );

      for (const migrationSql of CLEANUP) await transaction.unsafe(migrationSql);
      expect(await catalogue(transaction)).toEqual(before);
    });
  });

  it('leaves the write paths the triggers sat on working', async () => {
    await inRolledBackTransaction(async (transaction) => {
      for (const migrationSql of [...SIX_THREE_THREE_NINE, ...CLEANUP]) await transaction.unsafe(migrationSql);

      // Unlisting a published climb no longer writes a withdrawal marker.
      await transaction`
        INSERT INTO board_climbs (uuid, board_type, layout_id, name, is_listed, is_draft, updated_at)
        VALUES ('cleanup-6339-climb', 'kilter', 96340, 'Cleanup', true, false, now() - interval '1 hour')
      `;
      await transaction`UPDATE board_climbs SET is_listed = false WHERE uuid = 'cleanup-6339-climb'`;

      // A hard delete still writes its ordinary marker through the 0144
      // delete trigger, with no stream_at for it to stamp.
      await transaction`DELETE FROM board_climbs WHERE uuid = 'cleanup-6339-climb'`;
      const markers = await transaction<{ table_name: string; user_id: string | null }[]>`
        SELECT table_name, user_id FROM sync_deletions WHERE record_id = 'cleanup-6339-climb'
      `;
      expect(markers).toEqual([{ table_name: 'board_climbs', user_id: null }]);
    });
  });

  it('does not hold board_climbs while an open marker write keeps sync_deletions busy', async () => {
    const lockStep = migration('0274_drop_sync_deletion_stream_triggers').split('--> statement-breakpoint')[0];
    const connect = () => postgres(getWorkerDatabaseUrl(), { max: 1, onnotice: () => {} });
    const [markerWriter, migrator, climbReader] = [connect(), connect(), connect()];
    try {
      // An open transaction that wrote a deletion marker holds ROW EXCLUSIVE on
      // sync_deletions, which ACCESS EXCLUSIVE has to wait for.
      await markerWriter.unsafe('BEGIN');
      await markerWriter`INSERT INTO sync_deletions (table_name, record_id) VALUES ('board_climbs', 'lock-step-probe')`;

      const lockStepRun = migrator
        .begin(async (transaction) => {
          await transaction.unsafe(lockStep);
          throw new RollBack();
        })
        .catch((error: unknown) => {
          if (!(error instanceof RollBack)) throw error;
        });

      // Half a second in, the lock step has been refused sync_deletions. Had it
      // kept board_climbs while waiting, this read would wait out its 3 s too.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const readStartedAt = performance.now();
      await climbReader`SELECT count(*) FROM board_climbs`;
      const readMs = performance.now() - readStartedAt;

      await markerWriter.unsafe('ROLLBACK');
      await lockStepRun;
      expect(readMs).toBeLessThan(1000);
    } finally {
      await Promise.all([markerWriter.end(), migrator.end(), climbReader.end()]);
    }
  });
});
