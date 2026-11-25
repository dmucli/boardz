/// <reference types="node" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postgres from 'postgres';

const adminUrl = process.env.SYNC_CUTOFF_TEST_ADMIN_DATABASE_URL;
const bootstrapScript = new URL('./bootstrap-sync-deletions-cutoff-development.ts', import.meta.url).pathname;
const teardownScript = new URL('./teardown-sync-deletions-cutoff.ts', import.meta.url).pathname;
const run = (script: string, environment: NodeJS.ProcessEnv, arguments_: string[] = []) =>
  execFileSync('vp', ['exec', 'tsx', script, ...arguments_], { env: environment, encoding: 'utf8', stdio: 'pipe' });
// execFileSync puts the child's stderr on the thrown error's message.
const runFailure = (script: string, environment: NodeJS.ProcessEnv, arguments_: string[]) => {
  try {
    run(script, environment, arguments_);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  assert.fail(`${script} ${arguments_.join(' ')} was expected to fail`);
};

void test('plan never connects through an implicit DATABASE_URL', () => {
  assert.match(
    run(teardownScript, {
      ...process.env,
      DATABASE_URL: 'postgres://unused:unused@example.invalid/test',
      SYNC_CUTOFF_ADMIN_DATABASE_URL: '',
    }),
    /Plan: drop public\.sync_deletions_safe_cutoff/,
  );
});

void test('apply requires an explicit admin URL', () => {
  assert.match(
    runFailure(
      teardownScript,
      {
        ...process.env,
        DATABASE_URL: 'postgres://unused:unused@example.invalid/test',
        SYNC_CUTOFF_ADMIN_DATABASE_URL: '',
      },
      ['--apply'],
    ),
    /SYNC_CUTOFF_ADMIN_DATABASE_URL is required with --apply/,
  );
});

void test(
  'teardown refuses while anything still needs the helper, then removes the helper and its role',
  { skip: !adminUrl },
  async (context) => {
    const parsedUrl = new URL(adminUrl!);
    assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(parsedUrl.hostname));
    const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    const [ownerBefore] = await admin<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boardsesh_sync_cutoff_owner') AS exists
    `;
    if (ownerBefore.exists) {
      // The owner role is cluster-wide. Another database on this server owns a
      // helper, so the teardown would rightly refuse here.
      await admin.end();
      context.skip('boardsesh_sync_cutoff_owner already exists on this server');
      return;
    }

    const suffix = randomUUID().replaceAll('-', '');
    const databaseName = `cutoff_teardown_${suffix}`;
    const runtimeRole = `cutoff_runtime_${suffix}`;
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    parsedUrl.pathname = `/${databaseName}`;
    const environment = {
      ...process.env,
      SYNC_CUTOFF_DEVELOPMENT_BOOTSTRAP: 'true',
      SYNC_CUTOFF_ADMIN_DATABASE_URL: parsedUrl.toString(),
      SYNC_CUTOFF_RUNTIME_ROLE: runtimeRole,
    };
    const scratch = postgres(parsedUrl.toString(), { max: 1, onnotice: () => {} });
    const helperExists = async () => {
      const [helper] = await scratch<{ exists: boolean }[]>`
        SELECT to_regprocedure('public.sync_deletions_safe_cutoff(double precision)') IS NOT NULL AS exists
      `;
      return helper.exists;
    };
    try {
      // The state a database is in between 0273 and the cleanup migrations.
      await scratch.unsafe('CREATE TABLE public.sync_deletions (id bigserial PRIMARY KEY, stream_at timestamp)');
      assert.match(run(bootstrapScript, environment, ['--apply']), /Installed the cutoff helper/);

      assert.match(runFailure(teardownScript, environment, ['--apply']), /0274\/0275 have not run here/);
      assert.equal(await helperExists(), true);
      await scratch.unsafe('ALTER TABLE public.sync_deletions DROP COLUMN stream_at');

      await scratch.unsafe('CREATE VIEW cutoff_probe AS SELECT public.sync_deletions_safe_cutoff(1) AS cutoff');
      assert.match(runFailure(teardownScript, environment, ['--apply']), /is used by .*cutoff_probe/);
      await scratch.unsafe('DROP VIEW cutoff_probe');

      await scratch.unsafe('CREATE TABLE owned_probe (id integer)');
      await scratch.unsafe('ALTER TABLE owned_probe OWNER TO boardsesh_sync_cutoff_owner');
      assert.match(runFailure(teardownScript, environment, ['--apply']), /still owns or holds .*owned_probe/);
      await scratch.unsafe('DROP TABLE owned_probe');
      assert.equal(await helperExists(), true);

      assert.match(run(teardownScript, environment), /Plan \(no blockers found\):\n {2}DROP FUNCTION/);
      assert.equal(await helperExists(), true);

      assert.match(run(teardownScript, environment, ['--apply']), /Removed:\n {2}DROP FUNCTION[\s\S]*DROP ROLE/);
      assert.equal(await helperExists(), false);
      const [owner] = await admin<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boardsesh_sync_cutoff_owner') AS exists
      `;
      assert.equal(owner.exists, false);
      const contractSql = readFileSync(
        new URL('./sync-deletions-cutoff-contract.sql', import.meta.url),
        'utf8',
      ).replaceAll('__SYNC_RUNTIME_ROLE__', runtimeRole);
      const [contract] = await scratch.unsafe<{ matches: boolean }[]>(contractSql);
      assert.equal(contract.matches, true);

      assert.match(run(teardownScript, environment, ['--apply']), /Nothing to remove/);
    } finally {
      await scratch.end();
      await admin.unsafe(`DROP DATABASE "${databaseName}"`);
      await admin.unsafe(`DROP ROLE IF EXISTS "${runtimeRole}"`);
      await admin.unsafe('DROP ROLE IF EXISTS boardsesh_sync_cutoff_owner');
      await admin.end();
    }
  },
);
