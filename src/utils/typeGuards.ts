import type { CourseSyncSnapshot, RelaySyncEnvelope } from '../models/types';

export const isCourseSyncSnapshot = (value: unknown): value is CourseSyncSnapshot => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.snapshotVersion === 'number' &&
    typeof candidate.course === 'object' &&
    candidate.course !== null &&
    Array.isArray(candidate.flights)
  );
};

export const isRelaySyncEnvelope = (value: unknown): value is RelaySyncEnvelope => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.roomId === 'string' &&
    typeof candidate.courseSyncId === 'string' &&
    typeof candidate.deviceId === 'string' &&
    typeof candidate.opId === 'string' &&
    typeof candidate.opTs === 'string' &&
    typeof candidate.operation === 'string'
  );
};
