import { describe, it, expect, vi } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';
import React from 'react';
import PosterQr from '../poster-qr';

// Capture the QRCodeSVG props so the print-critical settings are assertable
// without decoding the matrix — the same trick the kiosk's install-QR test uses.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: (props: {
    value: string;
    className?: string;
    fgColor?: string;
    bgColor?: string;
    marginSize?: number;
    level?: string;
  }) => (
    <svg
      data-testid="qr"
      className={props.className}
      data-value={props.value}
      data-fg={props.fgColor}
      data-bg={props.bgColor}
      data-margin={String(props.marginSize)}
      data-level={props.level}
    />
  ),
}));

describe('PosterQr', () => {
  it('encodes exactly the value it is handed', () => {
    render(<PosterQr value="https://www.boardsesh.com/b/garage?src=qr&medium=board" />);
    expect(screen.getByTestId('qr').getAttribute('data-value')).toBe(
      'https://www.boardsesh.com/b/garage?src=qr&medium=board',
    );
  });

  it('sets black-on-white as SVG props, not CSS', () => {
    // Browsers drop background graphics when printing by default, so a CSS
    // quiet zone prints away and a dark-mode page yields a dark-on-dark code.
    // As props they are page content and always print.
    render(<PosterQr value="https://www.boardsesh.com/b/garage" />);
    const qr = screen.getByTestId('qr');
    expect(qr.getAttribute('data-fg')).toBe('#000000');
    expect(qr.getAttribute('data-bg')).toBe('#ffffff');
  });

  it('uses the spec 4-module quiet zone, not the kiosk margin', () => {
    render(<PosterQr value="https://www.boardsesh.com/b/garage" />);
    expect(screen.getByTestId('qr').getAttribute('data-margin')).toBe('4');
  });

  it('uses error correction Q for a code that gets scuffed on a wall', () => {
    render(<PosterQr value="https://www.boardsesh.com/b/garage" />);
    expect(screen.getByTestId('qr').getAttribute('data-level')).toBe('Q');
  });

  it('passes the sizing class through', () => {
    render(<PosterQr value="https://www.boardsesh.com/b/garage" className="sized" />);
    expect(screen.getByTestId('qr').getAttribute('class')).toBe('sized');
  });
});
