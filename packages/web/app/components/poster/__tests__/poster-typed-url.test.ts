import { describe, it, expect } from 'vite-plus/test';
import { posterTypedUrl } from '../poster-typed-url';

describe('posterTypedUrl', () => {
  it('prints the canonical host without the scheme', () => {
    expect(posterTypedUrl('/b/garage-wall')).toBe('www.boardsesh.com/b/garage-wall');
    expect(posterTypedUrl('/gym/boulderwelt-ost')).toBe('www.boardsesh.com/gym/boulderwelt-ost');
  });

  it('keeps an already-encoded path byte for byte', () => {
    expect(posterTypedUrl('/gym/boulder%231')).toBe('www.boardsesh.com/gym/boulder%231');
  });
});
