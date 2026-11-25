import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import PosterPrintBar from '../poster-print-bar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PosterPrintBar', () => {
  it('opens the browser print dialog', () => {
    // jsdom has no print implementation, so it is stubbed rather than spied on.
    const print = vi.fn();
    vi.stubGlobal('print', print);

    render(<PosterPrintBar backHref="/gym/test-gym" printLabel="Print this poster" backLabel="Back to the gym" />);
    fireEvent.click(screen.getByRole('button', { name: 'Print this poster' }));

    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('links back with the href it was handed', () => {
    render(<PosterPrintBar backHref="/gym/test-gym" printLabel="Print this poster" backLabel="Back to the gym" />);
    // A real anchor, not a click handler: the way back has to survive a page
    // printed from a browser with JS blocked, and be middle-clickable.
    expect(screen.getByRole('link', { name: 'Back to the gym' }).getAttribute('href')).toBe('/gym/test-gym');
  });

  it('carries a percent-encoded slug through untouched', () => {
    render(<PosterPrintBar backHref="/gym/boulder%231" printLabel="Print" backLabel="Back" />);
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/gym/boulder%231');
  });

  it('renders the labels the server passed rather than translating in the island', () => {
    // The i18n mock echoes keys, so a label rendered from a key would show the
    // key. Seeing the passed strings proves the island stays off client i18n.
    render(<PosterPrintBar backHref="/gym/test-gym" printLabel="Imprimer" backLabel="Retour" />);
    expect(screen.getByRole('button', { name: 'Imprimer' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour' })).toBeTruthy();
  });

  it("puts a poster's own controls in the bar, before the print button", () => {
    render(
      <PosterPrintBar backHref="/b/garage" printLabel="Print" backLabel="Back">
        <button type="button">Cards</button>
      </PosterPrintBar>,
    );
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Cards', 'Print']);
  });
});
