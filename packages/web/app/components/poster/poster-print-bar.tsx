'use client';

// Screen-only bar beside a poster: open the print dialog, or go back to the
// page the poster belongs to. `.noPrint` in `poster-sheet.module.css` removes it
// under `@media print`, so nothing here ends up on paper. A poster with more to
// choose (the board poster's layouts) passes those controls as `children`.

import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import LocaleLink from '@/app/components/i18n/locale-link';
import styles from './poster-sheet.module.css';

type PosterPrintBarProps = {
  backHref: string;
  /**
   * Already translated by the server component that renders this island — the
   * same arrangement `GymInstallCta` uses, so a static poster page doesn't drag
   * the client i18n bundle along for two button labels.
   */
  printLabel: string;
  backLabel: string;
  children?: React.ReactNode;
};

export default function PosterPrintBar({ backHref, printLabel, backLabel, children }: PosterPrintBarProps) {
  return (
    <Box className={styles.noPrint}>
      {children}
      <Button
        variant="contained"
        startIcon={<PrintOutlined />}
        onClick={() => window.print()}
        sx={{ textTransform: 'none' }}
      >
        {printLabel}
      </Button>
      <Button
        component={LocaleLink}
        href={backHref}
        variant="outlined"
        startIcon={<ArrowBackOutlined />}
        sx={{ textTransform: 'none' }}
      >
        {backLabel}
      </Button>
    </Box>
  );
}
