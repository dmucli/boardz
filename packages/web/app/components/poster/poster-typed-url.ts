import { absoluteUrl } from '@/app/lib/seo/base-url';

/**
 * The line a human types when a printed code won't scan: `www.boardsesh.com/gym/x`
 * or `www.boardsesh.com/b/x`, clean — no `?src=qr&medium=…`. Someone typing a
 * URL off a wall is not a scan, and asking them to key in two query params
 * would guarantee a typo and mislabel them as a scan if they got it right.
 *
 * Built from `absoluteUrl` so the host tracks the canonical site URL, then
 * stripped of its scheme: `https://` is noise on a printed line, and every
 * browser and phone keyboard adds it back.
 *
 * `path` must already be percent-encoded the way the printed code encodes it
 * (`gymQrUrl` and `boardQrUrl` both encode the slug). The code and this line
 * are printed centimetres apart on the same sheet, and "built by two code paths
 * that could disagree" is the exact failure a poster cannot recover from.
 */
export function posterTypedUrl(path: string): string {
  return absoluteUrl(path).replace(/^https?:\/\//, '');
}
