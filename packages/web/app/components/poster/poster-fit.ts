// The fitting rule behind `PosterFitText`, kept apart from the component so it
// can be tested without a layout engine: the line counter is a parameter.

/** Lines each type step may take, largest type first. Never empty: there is always a last, clamped step. */
export type LineBudgets = readonly [number, ...number[]];

/** Counts the lines an element's text occupies at its current step. */
export type LineCounter = (element: HTMLElement) => number;

/** Distinct line boxes the element's text occupies, read off the rendered layout. */
export function countRenderedLines(element: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(element);
  // jsdom implements no layout; a renderer without rects reads as one line.
  if (typeof range.getClientRects !== 'function') return 1;
  const lineTops = new Set<number>();
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width > 0) lineTops.add(Math.round(rect.top));
  }
  return lineTops.size;
}

/**
 * Set `data-fit-step` to the largest step whose line count is within its
 * budget, or to the last step (which clamps) when none is, and return it.
 *
 * `data-fit-measuring` is set while counting so the caller's clamp is lifted
 * and every line is seen; it is removed before returning.
 */
export function fitToBudget(
  element: HTMLElement,
  lineBudgets: LineBudgets,
  countLines: LineCounter = countRenderedLines,
): number {
  element.setAttribute('data-fit-measuring', '');
  let chosenStep = lineBudgets.length - 1;
  for (let step = 0; step < lineBudgets.length; step += 1) {
    element.setAttribute('data-fit-step', String(step));
    if (countLines(element) <= lineBudgets[step]) {
      chosenStep = step;
      break;
    }
  }
  element.setAttribute('data-fit-step', String(chosenStep));
  element.removeAttribute('data-fit-measuring');
  return chosenStep;
}

/**
 * Budgets back out of the comma-joined key the component memoises on, or
 * `null` for anything that is not a non-empty list of positive whole numbers —
 * so a bad key leaves the server's step alone instead of setting step -1.
 */
export function parseLineBudgets(budgetKey: string): LineBudgets | null {
  const [first, ...rest] = budgetKey.split(',').map(Number);
  if (first === undefined) return null;
  const budgets: LineBudgets = [first, ...rest];
  return budgets.every((budget) => Number.isInteger(budget) && budget > 0) ? budgets : null;
}
