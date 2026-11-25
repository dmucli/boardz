import { describe, it, expect } from 'vite-plus/test';
import { fitToBudget, parseLineBudgets, type LineCounter } from '../poster-fit';

/** A line counter that answers from a table keyed by the step being measured. */
function linesPerStep(lines: readonly number[]): LineCounter {
  return (element) => {
    // The caller's clamp must be lifted while counting, or hidden lines read as fitting.
    expect(element.hasAttribute('data-fit-measuring')).toBe(true);
    const step = Number(element.getAttribute('data-fit-step'));
    return lines[step] ?? Number.POSITIVE_INFINITY;
  };
}

function heading(): HTMLElement {
  const element = document.createElement('h1');
  element.setAttribute('data-fit-step', '2');
  return element;
}

describe('fitToBudget', () => {
  it('keeps the largest step when the name fits it', () => {
    const element = heading();
    expect(fitToBudget(element, [2, 2, 3], linesPerStep([1, 1, 1]))).toBe(0);
    expect(element.getAttribute('data-fit-step')).toBe('0');
  });

  it('steps down to the first step whose lines fit its budget', () => {
    const element = heading();
    // Four lines at the largest size, two at the next: the second step fits.
    expect(fitToBudget(element, [2, 2, 3], linesPerStep([4, 2, 2]))).toBe(1);
    expect(element.getAttribute('data-fit-step')).toBe('1');
  });

  it('settles on the last step, which clamps, when nothing fits', () => {
    const element = heading();
    expect(fitToBudget(element, [2, 2, 3], linesPerStep([9, 7, 5]))).toBe(2);
    expect(element.getAttribute('data-fit-step')).toBe('2');
  });

  it('uses the only step there is, whether or not it fits', () => {
    expect(fitToBudget(heading(), [2], linesPerStep([1]))).toBe(0);
    expect(fitToBudget(heading(), [2], linesPerStep([6]))).toBe(0);
  });

  it('puts the clamp back once it has measured', () => {
    const element = heading();
    fitToBudget(element, [2, 3], linesPerStep([5, 5]));
    expect(element.hasAttribute('data-fit-measuring')).toBe(false);
  });
});

describe('parseLineBudgets', () => {
  it('reads the comma-joined budgets back', () => {
    expect(parseLineBudgets('2,2,3')).toEqual([2, 2, 3]);
    expect(parseLineBudgets('3')).toEqual([3]);
  });

  it('refuses an empty key, so no step -1 is ever set', () => {
    expect(parseLineBudgets('')).toBeNull();
  });

  it('refuses anything that is not a positive whole number', () => {
    expect(parseLineBudgets('2,x')).toBeNull();
    expect(parseLineBudgets('2,0')).toBeNull();
    expect(parseLineBudgets('2.5')).toBeNull();
  });
});
