import { expect, it } from 'vitest';
import { isIncomingNewer } from './isIncomingNewer';

it('accepts equal/newer timestamps and rejects older or missing timestamps', () => {
  const old = '2026-01-01T10:00:00Z';
  const newer = '2026-01-01T10:01:00Z';
  expect(isIncomingNewer(newer, old)).toBe(true);
  expect(isIncomingNewer(old, newer)).toBe(false);
  expect(isIncomingNewer(old, old)).toBe(true);
  expect(isIncomingNewer(newer, undefined)).toBe(true);
  expect(isIncomingNewer(undefined, old)).toBe(false);
  expect(isIncomingNewer('invalid', old)).toBe(false);
});
