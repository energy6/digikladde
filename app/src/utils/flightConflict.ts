import type { Flight } from '../models/types';
import { maneuvers as maneuverOrder } from '../models/types';

export const DUPLICATE_START_WINDOW_MS = 60_000;
export const LANDING_PENDING_MS = 5 * 60 * 1000;

type FlightLike = Pick<Flight, 'syncId' | 'startTime' | 'maneuvers'> & Partial<Flight>;

export const hasFinalizedFlightState = (flight: Pick<Flight, 'endTime' | 'landingFinalizedAt'> | {
  endTime?: string | null;
  landingFinalizedAt?: string | null;
}): boolean => Boolean(flight.endTime || flight.landingFinalizedAt);

export const hasPendingLandingState = (flight: Pick<Flight, 'landingMarkedAt' | 'landingPendingUntil' | 'landingFinalizedAt'> | {
  landingMarkedAt?: string | null;
  landingPendingUntil?: string | null;
  landingFinalizedAt?: string | null;
}): boolean => Boolean(!flight.landingFinalizedAt && (flight.landingMarkedAt || flight.landingPendingUntil));

export const isOpenFlight = (flight: Pick<Flight, 'endTime' | 'landingFinalizedAt'>): boolean => !hasFinalizedFlightState(flight);

export const flightLifecycleRank = (flight: {
  endTime?: string | null;
  landingFinalizedAt?: string | null;
  landingMarkedAt?: string | null;
  landingPendingUntil?: string | null;
}): number => {
  if (hasFinalizedFlightState(flight)) return 3;
  if (hasPendingLandingState(flight)) return 2;
  return 1;
};

export const mergeManeuvers = (left?: string[] | null, right?: string[] | null): string[] => {
  const selected = new Set([...(left ?? []), ...(right ?? [])]);
  const order = new Map(maneuverOrder.map((maneuver, index) => [maneuver, index]));

  return Array.from(selected).sort((a, b) => {
    const aIndex = order.get(a);
    const bIndex = order.get(b);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return a.localeCompare(b);
  });
};

export const deriveLandingPendingUntil = (landingMarkedAt?: string | null): string | undefined => {
  if (!landingMarkedAt) return undefined;
  const parsed = Date.parse(landingMarkedAt);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed + LANDING_PENDING_MS).toISOString();
};

const parseTime = (value?: string | null): number => {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

export const isDuplicateStartWindow = (leftStartTime?: string, rightStartTime?: string): boolean => {
  const left = parseTime(leftStartTime);
  const right = parseTime(rightStartTime);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= DUPLICATE_START_WINDOW_MS;
};

export const compareStartWinner = (left: FlightLike, right: FlightLike): number => {
  const byStart = parseTime(left.startTime) - parseTime(right.startTime);
  if (byStart !== 0) return byStart;
  return String(left.syncId ?? '').localeCompare(String(right.syncId ?? ''));
};

export const chooseStartWinner = <T extends FlightLike>(flights: T[]): T | undefined => (
  [...flights].sort(compareStartWinner)[0]
);

export const isSameManeuverSet = (left?: string[] | null, right?: string[] | null): boolean => {
  const normalizedLeft = mergeManeuvers(left, []);
  const normalizedRight = mergeManeuvers(right, []);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};
