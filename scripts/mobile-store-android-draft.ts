/// <reference types="node" />

// Drafts one exact build on the Play production track: the completed internal
// release that carries ANDROID_VERSION_CODE goes to production with status
// `draft`, in one edit committed with changesInReviewBehavior=ERROR_IF_IN_REVIEW.
// Run by `fastlane android draft_submission` from the store-draft workflow, after
// the GET-only mobile-store-android-draft-guard.ts found production can take a
// draft.
//
// This replaces fastlane supply's promote (track_promote_to: production). It wrote
// the same track (only the draft release; Play keeps the live completed release
// beside it), but supply commits without changesInReviewBehavior, and the API
// default cancels a release that is in review and resubmits it. After a merge-back
// submits a production release (mobile-store-submit.yml), a draft run for the next
// train version would have restarted that review. Here a pending review makes the
// commit fail instead.
//
// One difference from supply: when production already holds a draft of this
// build, its name and release notes are kept (notes edited by hand in Play Console
// survive a rerun), as Android Production Release does.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  type JsonRecord,
  createPlayRequest,
  discardEdit,
  editReleases,
  hasNewerVersionCode,
  openEdit,
  releaseFromInternalEdit,
  releaseIdentity,
  releaseVersionCodes,
  trackSummaries,
  validateAndCommit,
} from './lib/google-play-tracks';
import { createAuditAccessToken, parseExpectedVersionCode } from './mobile-store-android-audit';

/** JSON with sorted keys, so two releases compare by content rather than key order. */
function stableJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stableJson).join(',')}]`;
  if (typeof input === 'object' && input !== null) {
    const entries = Object.entries(input as JsonRecord).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${stableJson(value)}`).join(',')}}`;
  }
  return JSON.stringify(input);
}

/** The production releases to write for a draft of the build, and whether production already says exactly that. */
export function productionDraftTrack(internalEdit: unknown, productionEdit: unknown, versionCode: number) {
  const internalRelease = releaseFromInternalEdit(internalEdit, versionCode);
  const current = editReleases(productionEdit, 'production');
  if (current.some((entry) => hasNewerVersionCode(entry, versionCode))) {
    throw new Error('Production edit contains a newer versionCode; refusing to draft over it');
  }
  const matches = current.filter((entry) => releaseVersionCodes(entry).includes(String(versionCode)));
  if (matches.length > 1) throw new Error('Production edit contains ambiguous releases for ANDROID_VERSION_CODE');
  const match = matches[0];
  if (match && match['status'] !== 'draft') {
    throw new Error(
      `ANDROID_VERSION_CODE is already ${String(match['status'])} on production; a draft would replace that release`,
    );
  }
  const release: JsonRecord = { ...internalRelease, ...(match ? releaseIdentity(match) : {}), status: 'draft' };
  const alreadyDrafted =
    match !== undefined &&
    stableJson(release) ===
      stableJson({ ...releaseIdentity(match), versionCodes: releaseVersionCodes(match), status: 'draft' });
  return { releases: [release], alreadyDrafted };
}

export async function draftAndroidProduction(options: { accessToken: string; versionCode: number }) {
  const { accessToken, versionCode } = options;
  parseExpectedVersionCode(String(versionCode));
  const request = createPlayRequest(accessToken, 'production draft');
  const editPath = await openEdit(request);
  const internalEdit = await request(`${editPath}/tracks/internal`);
  const productionEdit = await request(`${editPath}/tracks/production`);
  const { releases, alreadyDrafted } = productionDraftTrack(internalEdit, productionEdit, versionCode);
  if (alreadyDrafted) {
    // Nothing to write: drop the edit opened above rather than leave it pending until it expires.
    await discardEdit(request, editPath);
    return { action: 'already-drafted', versionCode, targetTrack: 'production' };
  }
  await request(`${editPath}/tracks/production`, 'PUT', { track: 'production', releases });
  await validateAndCommit(request, editPath);
  const receipt = trackSummaries(await request('/tracks/production/releases'), 'production');
  return {
    action: 'committed',
    versionCode,
    targetTrack: 'production',
    productionReleases: receipt,
    message: 'Draft committed; it is not sent for review and does not roll out.',
  };
}

async function main() {
  try {
    if (process.argv.slice(2).length > 0) throw new Error('No arguments are supported');
    const versionCode = parseExpectedVersionCode(process.env['ANDROID_VERSION_CODE'] ?? '');
    const secret = process.env['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'];
    if (!secret) throw new Error('Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
    const report = await draftAndroidProduction({ accessToken: await createAuditAccessToken(secret), versionCode });
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (process.env['STORE_DRAFT_OUTPUT']) writeFileSync(process.env['STORE_DRAFT_OUTPUT'], output);
    console.log(output);
    return 0;
  } catch (error) {
    console.error(`[mobile-store-android-draft] ${error instanceof Error ? error.message : 'Operation failed'}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then((exitCode) => process.exit(exitCode));
}
