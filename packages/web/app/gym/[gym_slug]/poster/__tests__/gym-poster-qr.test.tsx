import { describe, it, expect, vi } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SITE_URL } from '@/app/lib/seo/base-url';
import GymPosterQr from '../gym-poster-qr';

// Capture the QRCodeSVG props so the encoded target is assertable without
// decoding the matrix — the same trick the kiosk's install-QR test uses.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: { value: string }) => <svg data-testid="qr" data-value={props.value} />,
}));

describe('GymPosterQr', () => {
  it('encodes the canonical gym URL with the poster attribution params', () => {
    render(<GymPosterQr gymSlug="boulderwelt-ost" />);
    // Spelled out rather than round-tripped through gymQrUrl: this string is
    // printed and laminated, so the test states the exact bytes a phone will
    // resolve. Derived from SITE_URL so it tracks the base URL, not the host.
    expect(screen.getByTestId('qr').getAttribute('data-value')).toBe(
      `${SITE_URL}/gym/boulderwelt-ost?src=qr&medium=poster`,
    );
  });

  it('percent-encodes a slug so a printed URL is never malformed', () => {
    render(<GymPosterQr gymSlug="boulder#1" />);
    expect(screen.getByTestId('qr').getAttribute('data-value')).toBe(
      `${SITE_URL}/gym/boulder%231?src=qr&medium=poster`,
    );
  });

  // Black-on-white fills, level Q and the 4-module quiet zone are `PosterQr`'s
  // contract and are pinned in `components/poster/__tests__/poster-qr.test.tsx`.
});
