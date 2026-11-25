import { describe, it, expect } from 'vite-plus/test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { qrModuleCount, qrQuietZoneMm } from '../qr-geometry';

/** Modules per side of the code `qrcode.react` actually draws at level Q, without a quiet zone. */
function drawnModuleCount(text: string): number {
  const markup = renderToStaticMarkup(<QRCodeSVG value={text} level="Q" marginSize={0} />);
  const match = /viewBox="0 0 (\d+) \d+"/.exec(markup);
  if (!match) throw new Error('qrcode.react drew no viewBox');
  return Number(match[1]);
}

describe('qrModuleCount', () => {
  it('agrees with what qrcode.react draws at every URL length up to 300 bytes', () => {
    // Every version boundary from 1 to 13 sits inside this range, which covers
    // every URL a poster prints (an unlisted wall's code is ~120 bytes).
    const base = 'https://www.boardsesh.com/b/';
    for (let length = 1; length <= 300; length += 1) {
      const text = (base + 'x'.repeat(Math.max(0, length - base.length))).slice(0, length);
      expect(qrModuleCount(text), `length ${length}`).toBe(drawnModuleCount(text));
    }
  });

  it('counts bytes, not characters', () => {
    // "é" is two UTF-8 bytes: 11 of them overflow version 1's 11-byte capacity.
    expect(qrModuleCount('é'.repeat(5))).toBe(21);
    expect(qrModuleCount('é'.repeat(6))).toBe(25);
  });

  it('answers null for text no version holds', () => {
    expect(qrModuleCount('x'.repeat(1664))).toBeNull();
  });
});

describe('qrQuietZoneMm', () => {
  it('is four modules of the printed box', () => {
    // The mock's public wall URL: version 7, 45 modules + 8 quiet = 53 across.
    const url = 'https://www.boardsesh.com/b/alejandro-s-nchez-s-spraywall-2?src=qr&medium=board';
    expect(qrModuleCount(url)).toBe(45);
    expect(qrQuietZoneMm(url, 106)).toBeCloseTo((106 * 4) / 53, 6);
  });
});
