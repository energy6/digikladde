import { expect, it } from 'vitest';
import { getAltitudeDifferenceMeters, getCompletedFlightAltitudeMeters, getStudentTotalAltitudeMeters } from './altitudeMeters';
import { durationFormatter } from './DatetimeFormatter';

it.each([[undefined, 0], [NaN, 0], [Infinity, 0], [-100, 0], [0, 0], [850.9, 850]])(
  'normalizes altitude %s', (value, expected) => {
    expect(getAltitudeDifferenceMeters({ altitudeDifferenceMeters: value })).toBe(expected);
    if (value !== undefined) expect(getStudentTotalAltitudeMeters({ totalAltitudeMeters: value })).toBe(expected);
  },
);

it('counts altitude only for completed flights', () => {
  const details = { altitudeDifferenceMeters: 850 };
  expect(getCompletedFlightAltitudeMeters({ details })).toBe(0);
  expect(getCompletedFlightAltitudeMeters({ details, endTime: '2026-01-01T10:15:00Z' })).toBe(850);
});

it('formats exact flight duration from timestamps without a real flight delay', () => {
  const start = Date.parse('2026-01-01T10:00:00Z');
  expect(durationFormatter(start, start + 15 * 60_000)).toBe('0:15');
  expect(durationFormatter(start, start + 65 * 60_000)).toBe('1:05');
  expect(durationFormatter(start, start)).toBe('-');
  expect(durationFormatter(start)).toBe('-');
});
