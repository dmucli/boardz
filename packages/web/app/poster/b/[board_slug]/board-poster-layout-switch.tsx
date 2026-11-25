'use client';

// The screen-only layout choice on the board poster: photo poster, plain
// poster, or four cards. Each option is a real link (`?layout=`), so the choice
// survives a reload, works with JavaScript off, and the server renders the
// sheet that prints.

import React from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import LocaleLink from '@/app/components/i18n/locale-link';
import type { BoardPosterLayout } from '@/app/lib/board-poster';

export type BoardPosterLayoutOption = {
  layout: BoardPosterLayout;
  /** Already translated by the server component. */
  label: string;
  /** The poster URL for this layout, carrying the wall capability when the board needs one. */
  href: string;
};

type BoardPosterLayoutSwitchProps = {
  options: readonly BoardPosterLayoutOption[];
  selected: BoardPosterLayout;
  /** The group's accessible name, already translated. */
  label: string;
};

export default function BoardPosterLayoutSwitch({ options, selected, label }: BoardPosterLayoutSwitchProps) {
  return (
    <ToggleButtonGroup value={selected} exclusive size="small" aria-label={label}>
      {options.map((option) => (
        <ToggleButton
          key={option.layout}
          value={option.layout}
          component={LocaleLink}
          href={option.href}
          // Replace, not push: switching layouts is a setting, not a page the
          // back button should walk through.
          replace
          scroll={false}
          aria-current={option.layout === selected ? 'page' : undefined}
          sx={{ textTransform: 'none' }}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
