import { afterEach, describe, expect, it, vi } from 'vitest';

import { draftAndroidProduction, productionDraftTrack } from '../mobile-store-android-draft';

const VERSION = 2001310;
const LIVE = 2001108;
const internalEdit = {
  track: 'internal',
  releases: [
    {
      name: '2.7.0',
      status: 'completed',
      versionCodes: [String(VERSION)],
      releaseNotes: [{ language: 'en-US', text: 'Climb with your crew' }],
      countryTargeting: { countries: ['ES'] },
    },
  ],
};
const live = { name: '2.6.0', status: 'completed', versionCodes: [String(LIVE)] };
const productionEdit = (...releases: unknown[]) => ({ track: 'production', releases });

function mockResponses(responses: unknown[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response instanceof Response ? response : new Response(JSON.stringify(response)));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const calls = (fetchMock: ReturnType<typeof mockResponses>) =>
  fetchMock.mock.calls.map(([url, options]) => [(url as string).split('/com.boardsesh.app')[1], options?.method]);
afterEach(() => vi.unstubAllGlobals());

describe('Android production draft', () => {
  it('drafts only the exact internal build and leaves the live release to Play', () => {
    const { releases, alreadyDrafted } = productionDraftTrack(internalEdit, productionEdit(live), VERSION);
    expect(alreadyDrafted).toBe(false);
    expect(releases).toEqual([
      {
        name: '2.7.0',
        status: 'draft',
        versionCodes: [String(VERSION)],
        releaseNotes: [{ language: 'en-US', text: 'Climb with your crew' }],
      },
    ]);
  });

  it('keeps the name and notes of an existing draft of the same build', () => {
    const edited = {
      name: '2.7.0',
      status: 'draft',
      versionCodes: [String(VERSION)],
      releaseNotes: [{ language: 'en-US', text: 'Edited in Play Console' }],
    };
    const { releases, alreadyDrafted } = productionDraftTrack(internalEdit, productionEdit(live, edited), VERSION);
    expect(releases[0]).toMatchObject({ releaseNotes: [{ language: 'en-US', text: 'Edited in Play Console' }] });
    expect(alreadyDrafted).toBe(true);
  });

  it.each(['completed', 'inProgress', 'halted'])(
    'refuses to turn a %s release of the build back into a draft',
    (status) => {
      expect(() =>
        productionDraftTrack(internalEdit, productionEdit({ status, versionCodes: [String(VERSION)] }), VERSION),
      ).toThrow(`already ${status}`);
    },
  );

  it('refuses to draft under a newer build, or from an ambiguous or missing internal release', () => {
    expect(() =>
      productionDraftTrack(
        internalEdit,
        productionEdit({ status: 'draft', versionCodes: [String(VERSION + 1)] }),
        VERSION,
      ),
    ).toThrow('newer versionCode');
    expect(() => productionDraftTrack({ track: 'internal', releases: [] }, productionEdit(live), VERSION)).toThrow(
      'exactly one completed internal release',
    );
    const twice = { status: 'draft', versionCodes: [String(VERSION)] };
    expect(() => productionDraftTrack(internalEdit, productionEdit(twice, twice), VERSION)).toThrow('ambiguous');
  });

  it('writes one edit and commits it with ERROR_IF_IN_REVIEW, never the API default', async () => {
    const fetchMock = mockResponses([
      { id: 'edit-1' },
      internalEdit,
      productionEdit(live),
      { track: 'production' },
      {},
      {},
      {
        releases: [
          { releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_DRAFT', activeArtifacts: [{ versionCode: VERSION }] },
        ],
      },
    ]);
    expect(await draftAndroidProduction({ accessToken: 'secret', versionCode: VERSION })).toMatchObject({
      action: 'committed',
    });
    expect(calls(fetchMock)).toEqual([
      ['/edits', 'POST'],
      ['/edits/edit-1/tracks/internal', 'GET'],
      ['/edits/edit-1/tracks/production', 'GET'],
      ['/edits/edit-1/tracks/production', 'PUT'],
      ['/edits/edit-1:validate', 'POST'],
      ['/edits/edit-1:commit?changesNotSentForReview=false&changesInReviewBehavior=ERROR_IF_IN_REVIEW', 'POST'],
      ['/tracks/production/releases', 'GET'],
    ]);
    const body = JSON.parse(fetchMock.mock.calls[3]![1]!.body as string) as { releases: Array<{ status: string }> };
    expect(body.releases.map((release) => release.status)).toEqual(['draft']);
  });

  it('discards its own edit when production already holds the exact draft', async () => {
    const drafted = { ...internalEdit.releases[0], status: 'draft', countryTargeting: undefined };
    const fetchMock = mockResponses([
      { id: 'edit-1' },
      internalEdit,
      productionEdit(live, drafted),
      new Response(null, { status: 204 }),
    ]);
    expect(await draftAndroidProduction({ accessToken: 'secret', versionCode: VERSION })).toMatchObject({
      action: 'already-drafted',
    });
    expect(calls(fetchMock)).toEqual([
      ['/edits', 'POST'],
      ['/edits/edit-1/tracks/internal', 'GET'],
      ['/edits/edit-1/tracks/production', 'GET'],
      ['/edits/edit-1', 'DELETE'],
    ]);
  });

  it('fails without retrying when Play refuses the commit for a pending review', async () => {
    const fetchMock = mockResponses([
      { id: 'edit-1' },
      internalEdit,
      productionEdit(live),
      { track: 'production' },
      {},
      new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'Changes are in review' } }), {
        status: 400,
      }),
    ]);
    await expect(draftAndroidProduction({ accessToken: 'secret', versionCode: VERSION })).rejects.toThrow(
      'HTTP 400 (POST /edits/edit-1:commit?changesNotSentForReview=false&changesInReviewBehavior=ERROR_IF_IN_REVIEW)',
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
