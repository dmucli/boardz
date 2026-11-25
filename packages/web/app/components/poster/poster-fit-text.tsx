'use client';

// A printed name that steps its size down until it fits its line budget, then
// clamps with an ellipsis (#4415).
//
// A Spraywall's name can run to 200 characters, and a poster has room for two
// or three lines of it. Counting characters guesses; measuring knows — a name of
// "W"s and a name of "i"s of the same length wrap very differently. So the
// server picks a first step from the length (what prints if JavaScript never
// runs), and this island measures the real line count and settles on the
// largest step that fits, before the page is printed.
//
// The steps themselves (size, leading, tracking, clamp) live in the caller's
// stylesheet as `[data-fit-step='N']` rules; this component only knows each
// step's line budget and moves the attribute.

import React, { useLayoutEffect, useRef } from 'react';
import { fitToBudget, parseLineBudgets, type LineBudgets } from './poster-fit';
import styles from './poster-fit-text.module.css';

type PosterFitTextProps = {
  text: string;
  className?: string;
  /** How many lines each step may take, largest type first. The last step clamps. */
  lineBudgets: LineBudgets;
  /** The step the server guessed from the text's length; what prints without JavaScript. */
  initialStep: number;
  as?: 'h1' | 'h2';
};

export default function PosterFitText({ text, className, lineBudgets, initialStep, as = 'h1' }: PosterFitTextProps) {
  const elementRef = useRef<HTMLHeadingElement>(null);
  // A string key, so a fresh array with the same budgets does not refit.
  const budgetKey = lineBudgets.join(',');

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    const budgets = parseLineBudgets(budgetKey);
    // A malformed key keeps the server's step rather than measuring nothing.
    if (!budgets) return undefined;
    const fit = () => {
      fitToBudget(element, budgets);
    };
    fit();
    // A web font (or a slow system font fallback) can land after first layout
    // and change every line break; measure again once fonts settle, and once
    // more as the print dialog opens.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) fit();
    });
    window.addEventListener('beforeprint', fit);
    return () => {
      cancelled = true;
      window.removeEventListener('beforeprint', fit);
    };
  }, [budgetKey, text]);

  const Heading = as;
  const classNames = [styles.fitText, className].filter(Boolean).join(' ');
  return (
    <Heading ref={elementRef} className={classNames} data-fit-step={initialStep}>
      {text}
    </Heading>
  );
}
