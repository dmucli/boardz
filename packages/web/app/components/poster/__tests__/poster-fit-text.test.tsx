import { describe, it, expect } from 'vite-plus/test';
import { render, screen } from '@testing-library/react';
import React from 'react';
import PosterFitText from '../poster-fit-text';

describe('PosterFitText', () => {
  it("server-renders the server's guess, then settles on a measured step", () => {
    // jsdom has no layout, so every name measures as fitting the largest step.
    render(<PosterFitText text="Sharma big spraywall" lineBudgets={[2, 2, 3]} initialStep={2} />);
    const heading = screen.getByRole('heading', { name: 'Sharma big spraywall' });
    expect(heading.getAttribute('data-fit-step')).toBe('0');
    expect(heading.hasAttribute('data-fit-measuring')).toBe(false);
  });

  it('renders the heading level it is asked for', () => {
    render(<PosterFitText text="Card name" lineBudgets={[2]} initialStep={0} as="h2" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Card name' })).toBeTruthy();
  });
});
