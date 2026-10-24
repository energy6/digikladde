import { describe, expect, it } from 'vitest';
import {
  chooseStartWinner, deriveLandingPendingUntil, flightLifecycleRank,
  hasFinalizedFlightState, isDuplicateStartWindow, isOpenFlight, mergeManeuvers,
} from './flightConflict';

const startTime = '2026-01-01T10:00:00.000Z';

describe('flight lifecycle', () => {
  it('distinguishes open, pending and finalized flights', () => {
    expect(isOpenFlight({})).toBe(true);
    expect(flightLifecycleRank({})).toBe(1);
    expect(flightLifecycleRank({ landingMarkedAt: startTime })).toBe(2);
    expect(flightLifecycleRank({ endTime: startTime })).toBe(3);
    expect(hasFinalizedFlightState({ landingFinalizedAt: startTime })).toBe(true);
    expect(isOpenFlight({ endTime: startTime })).toBe(false);
  });

  it('derives the real five-minute deadline without waiting', () => {
    expect(deriveLandingPendingUntil(startTime)).toBe('2026-01-01T10:05:00.000Z');
    expect(deriveLandingPendingUntil('invalid')).toBeUndefined();
    expect(deriveLandingPendingUntil()).toBeUndefined();
  });

  it.each([[-60_001, false], [-60_000, true], [0, true], [60_000, true], [60_001, false]])(
    'checks duplicate start boundary %i ms', (delta, duplicate) => {
      expect(isDuplicateStartWindow(startTime, new Date(Date.parse(startTime) + delta).toISOString())).toBe(duplicate);
    },
  );

  it('rejects missing/invalid start times and chooses a stable winner', () => {
    expect(isDuplicateStartWindow(startTime, 'invalid')).toBe(false);
    expect(isDuplicateStartWindow(undefined, startTime)).toBe(false);
    const a = { syncId: 'a', startTime, maneuvers: [] };
    const b = { ...a, syncId: 'b' };
    expect(chooseStartWinner([b, a])).toEqual(a);
    expect(chooseStartWinner([a, b])).toEqual(a);
    expect(chooseStartWinner([])).toBeUndefined();
  });

  it('unions maneuvers in canonical order without duplicates', () => {
    expect(mergeManeuvers(['Rollen', 'Acht'], ['Ohren anlegen', 'Acht'])).toEqual(['Ohren anlegen', 'Acht', 'Rollen']);
    expect(mergeManeuvers()).toEqual([]);
  });
});
