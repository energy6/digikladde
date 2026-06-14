import { landingRatingKey, startRatingKey, type ManeuverRatings } from '../models/types';

export const getRatingKeys = (maneuvers: string[]): string[] => [
  startRatingKey,
  ...maneuvers,
  landingRatingKey,
];

export const normalizeRating = (value: number | undefined): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(10, Math.max(0, Math.round(value)));
};

export const buildRatings = (
  maneuvers: string[],
  primaryRatings?: ManeuverRatings,
  fallbackRatings?: ManeuverRatings,
): ManeuverRatings => {
  const nextRatings: ManeuverRatings = {};

  getRatingKeys(maneuvers).forEach((ratingKey) => {
    nextRatings[ratingKey] = normalizeRating(primaryRatings?.[ratingKey] ?? fallbackRatings?.[ratingKey]);
  });

  return nextRatings;
};

export const hasSameRatings = (
  left: ManeuverRatings,
  right: ManeuverRatings,
  maneuvers: string[],
): boolean => (
  getRatingKeys(maneuvers).every((ratingKey) => (
    normalizeRating(left[ratingKey]) === normalizeRating(right[ratingKey])
  ))
);

export const formatRatingLabel = (label: string, ratings?: ManeuverRatings): string => {
  const rating = ratings?.[label];
  return typeof rating === 'number' ? `${label} (${rating}/10)` : label;
};

export const formatRatingLabels = (maneuvers: string[], ratings?: ManeuverRatings): string => (
  getRatingKeys(maneuvers)
    .map((label) => formatRatingLabel(label, ratings))
    .join(', ')
);
