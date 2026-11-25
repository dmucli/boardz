import { describe, it, expect } from 'vite-plus/test';
import { splitHeadlineAtBrand } from '../board-poster-sheets';
import { CARD_NAME_FIT, PHOTO_NAME_FIT, PLAIN_NAME_FIT, estimateNameFitStep } from '../name-fit';
import en from '@boardsesh/i18n/locales/en-US/kiosk.json';
import es from '@boardsesh/i18n/locales/es/kiosk.json';
import fr from '@boardsesh/i18n/locales/fr/kiosk.json';
import de from '@boardsesh/i18n/locales/de/kiosk.json';

describe('splitHeadlineAtBrand', () => {
  it('splits the English headline so the mark can sit in front of the brand', () => {
    expect(splitHeadlineAtBrand('This Spraywall is on Boardsesh')).toEqual({ lead: 'This Spraywall is on', trail: '' });
  });

  it.each([
    ['en-US', en],
    ['es', es],
    ['fr', fr],
    ['de', de],
  ])('finds the untranslated brand in every %s headline', (_locale, catalog) => {
    for (const headline of [catalog.boardPoster.spray.headline, catalog.boardPoster.led.headline]) {
      const split = splitHeadlineAtBrand(headline);
      expect(split).not.toBeNull();
      expect(`${split?.lead} Boardsesh${split?.trail}`).toBe(headline);
    }
  });

  it('returns null for a headline without the brand, so the sheet prints it whole', () => {
    expect(splitHeadlineAtBrand('Scan me')).toBeNull();
  });
});

describe('estimateNameFitStep', () => {
  it('starts a short name at the largest step', () => {
    expect(estimateNameFitStep('Sharma big spraywall', PLAIN_NAME_FIT)).toBe(0);
    expect(estimateNameFitStep('Sharma big spraywall', PHOTO_NAME_FIT)).toBe(0);
    expect(estimateNameFitStep('Sharma big spraywall', CARD_NAME_FIT)).toBe(0);
  });

  it('starts a 200-character name at the last, clamped step', () => {
    const longName = 'The Big Overhanging Spraywall in the Back Room '.repeat(5).slice(0, 200);
    expect(estimateNameFitStep(longName, PLAIN_NAME_FIT)).toBe(PLAIN_NAME_FIT.lineBudgets.length - 1);
  });

  it('keeps one more line budget than character budget, so every guess names a real step', () => {
    for (const profile of [PLAIN_NAME_FIT, PHOTO_NAME_FIT, CARD_NAME_FIT]) {
      expect(profile.lineBudgets.length).toBe(profile.characterBudgets.length + 1);
    }
  });
});
