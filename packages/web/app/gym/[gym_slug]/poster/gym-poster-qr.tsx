'use client';

// The printed code on the gym poster (#4379). How a poster code prints — level
// Q, a 4-module quiet zone, black-on-white as SVG fills — is `PosterQr`'s job;
// this only decides what it encodes.

import React from 'react';
import PosterQr from '@/app/components/poster/poster-qr';
import { gymQrUrl } from '@/app/lib/gym-attribution';
import styles from './gym-poster.module.css';

export default function GymPosterQr({ gymSlug }: { gymSlug: string }) {
  // `gymQrUrl` — never a hand-built string. The printed code and every counter
  // that reads `?src=qr&medium=poster` have to come out of one function, because
  // a disagreement between them is only discovered after the poster is on a wall.
  return <PosterQr className={styles.qr} value={gymQrUrl(gymSlug, 'poster')} />;
}
