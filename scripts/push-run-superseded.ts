/// <reference types="node" />

// Decides whether a push-triggered run on a release branch has been superseded
// by a later push, so it can skip work its successor will redo.
//
// The release workflows queue their runs (`queue: max`), so a run can start long
// after its push, when the branch has already moved on. Skipping it is only safe
// when a later run is certain to follow, and GitHub starts a push run only for a
// push that touches the workflow's `on.push.paths`. So a run counts as superseded
// only when the branch tip differs from its commit inside those paths. A tip that
// moved only outside them (docs, backend, web) left this commit's mobile tree as
// the newest one, no later run of this workflow exists, and this run must decide.
//
// Usage (from a workflow step, after `vp install`):
//   node --experimental-strip-types scripts/push-run-superseded.ts --workflow .github/workflows/<file>.yml
// Reads GITHUB_REF and GITHUB_SHA. Prints `true` or `false` on stdout and the
// reason on stderr. Exits non-zero when git cannot answer, so the caller decides
// whether that fails closed or open.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parse } from 'yaml';

export type SupersededDecision = { superseded: boolean; reason: string };

/**
 * The workflow's push `paths`, as git pathspecs. `:(glob)` gives `*` and `**` the
 * same meaning they have in a GitHub path filter (`*` stops at `/`). Negated
 * patterns are refused rather than approximated: a wrong pathspec would decide
 * which runs get skipped. An empty result means an unfiltered push: passing no
 * pathspecs to git diff compares every file.
 */
export function triggerPathspecs(workflowSource: string): string[] {
  const workflow: unknown = parse(workflowSource);
  const push = (workflow as { on?: { push?: { paths?: unknown; 'paths-ignore'?: unknown } | null } } | null)?.on?.push;
  if (push === undefined) throw new Error('the workflow has no on.push trigger');
  if (push?.['paths-ignore'] !== undefined) throw new Error('on.push.paths-ignore is not supported');
  const paths = push?.paths;
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('the workflow has an invalid on.push.paths list');
  }
  return paths.map((path) => {
    if (typeof path !== 'string' || path.length === 0) throw new Error('on.push.paths holds a non-string entry');
    if (path.startsWith('!')) throw new Error(`negated path filter ${path} is not supported`);
    return `:(glob)${path}`;
  });
}

/** The sha `refs/heads/<branch>` points at in `git ls-remote` output, or null when it is gone. */
export function tipFromLsRemote(listing: string, ref: string): string | null {
  for (const line of listing.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && sha && /^[0-9a-f]{40}$/.test(sha)) return sha;
  }
  return null;
}

export function decideSuperseded(input: {
  ref: string;
  sha: string;
  tip: string | null;
  changedTriggerPaths: readonly string[];
}): SupersededDecision {
  const branch = input.ref.replace(/^refs\/heads\//, '');
  if (input.tip === null) {
    return {
      superseded: true,
      reason: `${branch} no longer exists, so there is nothing left to build from ${input.sha}.`,
    };
  }
  if (input.tip === input.sha) {
    return { superseded: false, reason: `${input.sha} is still the tip of ${branch}.` };
  }
  if (input.changedTriggerPaths.length > 0) {
    return {
      superseded: true,
      reason:
        `${branch} moved from ${input.sha} to ${input.tip}, and the later pushes changed ` +
        `${input.changedTriggerPaths.length} file(s) this workflow triggers on (first: ${input.changedTriggerPaths[0]}), ` +
        'so a later run of this workflow follows and decides.',
    };
  }
  return {
    superseded: false,
    reason:
      `${branch} moved from ${input.sha} to ${input.tip}, but only outside this workflow's paths, ` +
      `so no later run follows and this run decides for ${input.sha}.`,
  };
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Make `sha` available for a tree diff. A shallow checkout (the native gates)
 * fetches just that one commit. A complete clone (the OTA publisher) must never
 * take a `--depth` fetch: it would turn the clone shallow and break the history
 * reads that run later in the same job.
 */
function ensureCommit(sha: string): void {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return;
  } catch {
    // Not present yet; fetch it below.
  }
  // Fetching a bare SHA needs the server to allow it (uploadpack.allowReachableSHA1InWant).
  // GitHub allows it for any commit reachable from a ref. If the fetch fails, main() exits 1
  // and each calling workflow step applies its own policy to that.
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  git(['fetch', '--no-tags', ...(shallow ? ['--depth=1'] : []), 'origin', sha]);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const flagIndex = argv.indexOf('--workflow');
    const workflowPath = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
    if (!workflowPath) throw new Error('pass --workflow <path to the workflow file>');
    const ref = requiredEnv('GITHUB_REF');
    const sha = requiredEnv('GITHUB_SHA');
    const pathspecs = triggerPathspecs(readFileSync(workflowPath, 'utf8'));

    const tip = tipFromLsRemote(git(['ls-remote', 'origin', ref]), ref);
    let changedTriggerPaths: string[] = [];
    if (tip !== null && tip !== sha) {
      // A tree diff needs both commits, not the history between them.
      ensureCommit(tip);
      changedTriggerPaths = git(['diff', '--name-only', sha, tip, '--', ...pathspecs])
        .split('\n')
        .filter((path) => path.length > 0);
    }

    const decision = decideSuperseded({ ref, sha, tip, changedTriggerPaths });
    console.error(`[push-run-superseded] ${decision.reason}`);
    process.stdout.write(`${decision.superseded}\n`);
    return 0;
  } catch (error) {
    console.error(`[push-run-superseded] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
