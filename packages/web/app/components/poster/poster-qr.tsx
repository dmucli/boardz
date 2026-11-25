'use client';

// The printed code on every poster: the gym poster (#4379) and the board poster
// (#4415). Callers decide what it encodes; this decides how it prints.
//
// A client island because `qrcode.react` calls hooks — the rest of a poster is
// server-rendered.

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QR_QUIET_ZONE_MODULES } from './qr-geometry';

// COLOURS ARE COMPONENT PROPS, NOT CSS, AND THAT IS THE WHOLE POINT.
//
// Browsers strip background graphics when printing unless the reader ticks the
// box, so a white quiet zone painted as a CSS background disappears on paper
// and a dark-mode page prints a dark code on dark — unscannable, and only
// discovered after someone laminates it. As SVG fills they are page content:
// they print by default, in every theme, on every browser.
const POSTER_QR_FOREGROUND = '#000000';
const POSTER_QR_BACKGROUND = '#ffffff';

type PosterQrProps = {
  /** The absolute URL the code encodes. Build it with `gymQrUrl` / `boardQrUrl`, never by hand. */
  value: string;
  /** Sizes the SVG in millimetres; the component sets no size of its own. */
  className?: string;
};

export default function PosterQr({ value, className }: PosterQrProps) {
  return (
    <QRCodeSVG
      className={className}
      value={value}
      // Internal resolution only; the CSS sizes the SVG in millimetres.
      size={512}
      fgColor={POSTER_QR_FOREGROUND}
      bgColor={POSTER_QR_BACKGROUND}
      // Error correction Q (25%) rather than the kiosk's M. A kiosk QR lives on
      // a clean backlit screen; this one gets taped to a wall, scuffed and
      // fingerprinted.
      level="Q"
      // The spec quiet zone is 4 modules. The kiosk uses 1, which is fine
      // against its own white tile and wrong on paper next to printed text.
      // `qr-geometry.ts` sizes layouts around this same number.
      marginSize={QR_QUIET_ZONE_MODULES}
      // The typed-URL line near the code is the accessible equivalent, so the
      // matrix itself is decoration to a screen reader.
      aria-hidden
    />
  );
}
