import { db } from '../db/database';
import type { Flight, RelaySyncEnvelope } from '../models/types';

export const findCourseFlight = async (
  syncId: string,
  courseId: number | undefined,
): Promise<Flight | undefined> => {
  const flights = await db.flights.where('syncId').equals(syncId).toArray();
  if (flights.some((flight) => flight.courseId !== courseId)) {
    throw new Error('Flug-ID ist einem anderen Kurs zugeordnet.');
  }
  return flights[0];
};

export const assertDeltaFlightCourse = async (envelope: RelaySyncEnvelope): Promise<void> => {
  if (envelope.operation !== 'flight_upsert' && envelope.operation !== 'flight_delete') return;
  const payload = envelope.payload;
  if (typeof payload !== 'object' || payload === null
    || !('syncId' in payload) || typeof payload.syncId !== 'string') return;

  const course = await db.courses.where('syncId').equals(envelope.courseSyncId).first();
  await findCourseFlight(payload.syncId, course?.id);
};

const readUpdatedAt = (value: unknown): string | undefined => (
  typeof value === 'object' && value !== null && 'updatedAt' in value && typeof value.updatedAt === 'string'
    ? value.updatedAt
    : undefined
);

export const hasNewerOrEqualFlightDelete = async (
  courseSyncId: string,
  syncId: string,
  incomingUpdatedAt?: string,
): Promise<boolean> => {
  const deleteEvents = await db.syncEvents
    .where('entitySyncId')
    .equals(syncId)
    .filter((event) => event.courseSyncId === courseSyncId && event.operation === 'flight_delete')
    .toArray();

  return deleteEvents.some((event) => {
    const deletedAt = readUpdatedAt(event.payload) ?? event.opTs;
    if (!incomingUpdatedAt) return true;
    return Date.parse(deletedAt) >= Date.parse(incomingUpdatedAt);
  });
};
