import { expect, it } from 'vitest';
import { buildRatings, formatRatingLabels, getRatingKeys, hasSameRatings, normalizeRating } from './maneuverRatings';

it.each([[undefined, 0], [NaN, 0], [-1, 0], [3.6, 4], [11, 10]])(
  'normalizes rating %s to %s', (input, output) => {
    expect(normalizeRating(input)).toBe(output);
  },
);

it('preserves existing ratings and falls back when adding maneuvers', () => {
  const ratings = buildRatings(['Acht', 'Rollen'], { Start: 8, Acht: 7 }, { Rollen: 6, Landung: 9 });
  expect(getRatingKeys(['Acht', 'Rollen'])).toEqual(['Start', 'Acht', 'Rollen', 'Landung']);
  expect(ratings).toEqual({ Start: 8, Acht: 7, Rollen: 6, Landung: 9 });
  expect(buildRatings(['Acht'], ratings)).toEqual({ Start: 8, Acht: 7, Landung: 9 });
  expect(hasSameRatings(ratings, { ...ratings, Rollen: 1 }, ['Acht'])).toBe(true);
  expect(hasSameRatings(ratings, { ...ratings, Start: 1 }, ['Acht'])).toBe(false);
  expect(formatRatingLabels(['Acht'], ratings)).toBe('Start (8/10), Acht (7/10), Landung (9/10)');
});
