// How each board-poster sheet fits a long name: the line budget of every type
// step (largest first), and the character counts the server uses to guess a
// first step before `PosterFitText` measures the real thing in the browser.
//
// The sizes, leading and clamp of each step live beside these in
// `board-poster.module.css` as `[data-fit-step='N']` rules; the budgets here
// must match the clamps there step for step.

import type { LineBudgets } from '@/app/components/poster/poster-fit';

export type NameFitProfile = {
  /** Lines each step may take. The last step clamps with an ellipsis. */
  lineBudgets: LineBudgets;
  /**
   * The longest name the server expects each step (but the last) to hold.
   * Only a first guess for a page printed with JavaScript off; measurement wins.
   */
  characterBudgets: readonly number[];
};

/** Plain poster: 16 → 12 mm on two lines across the full 186 mm, then 9 mm on three. */
export const PLAIN_NAME_FIT: NameFitProfile = { lineBudgets: [2, 2, 3], characterBudgets: [34, 52] };

/** Photo poster: 12 mm on two lines in the column beside the code, then 9.5 and 7.5 mm on three. */
export const PHOTO_NAME_FIT: NameFitProfile = { lineBudgets: [2, 3, 3], characterBudgets: [22, 42] };

/** Card: 7 → 5.5 mm on two lines across the card, then 4.5 mm on three. */
export const CARD_NAME_FIT: NameFitProfile = { lineBudgets: [2, 2, 3], characterBudgets: [32, 48] };

/** The server's first guess at a step for `name`, from its length alone. */
export function estimateNameFitStep(name: string, profile: NameFitProfile): number {
  const step = profile.characterBudgets.findIndex((budget) => name.length <= budget);
  return step === -1 ? profile.lineBudgets.length - 1 : step;
}
