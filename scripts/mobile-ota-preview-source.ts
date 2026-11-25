/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { object } from './lib/ota-publish-protocol.ts';

/** Restore the retained generated candidate, never approximate it by rebasing again. */
export function restorePreviewSource(
  repository: string,
  receiptInput: unknown,
  platform: string,
  bundle: string,
): void {
  const receipt = object(receiptInput, 'Preview receipt');
  if (receipt.version !== 2) throw new Error('Generated source requires preview receipt v2.');
  if (!['ios', 'android'].includes(platform)) throw new Error('Unknown source platform.');
  const fields = object(object(receipt.platforms, 'Platforms')[platform], 'Source platform');
  for (const key of ['candidateCommit', 'candidateTree', 'targetSha'])
    if (typeof fields[key] !== 'string' || !/^[0-9a-f]{40}$/.test(fields[key]))
      throw new Error('Invalid generated source SHA.');
  if (
    typeof fields.sourceBundleSha256 !== 'string' ||
    createHash('sha256').update(readFileSync(bundle)).digest('hex') !== fields.sourceBundleSha256
  )
    throw new Error('Generated source bundle hash differs from receipt.');
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // A compact bundle needs its pinned target as a prerequisite. Fetch by SHA,
  // never a moving branch name; no GitHub credential is persisted in this tree.
  git(['fetch', 'origin', String(fields.targetSha)]);
  git(['bundle', 'verify', bundle]);
  git(['fetch', bundle, 'HEAD']);
  if (git(['rev-parse', 'FETCH_HEAD']) !== fields.candidateCommit)
    throw new Error('Bundle HEAD differs from generated candidate.');
  if (git(['rev-parse', `${String(fields.candidateCommit)}^{tree}`]) !== fields.candidateTree)
    throw new Error('Generated source tree differs from receipt.');
  git(['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', String(fields.candidateCommit)]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [repository, receiptPath, platform, bundle] = process.argv.slice(2);
  restorePreviewSource(repository, JSON.parse(readFileSync(receiptPath, 'utf8')), platform, resolve(bundle));
}
