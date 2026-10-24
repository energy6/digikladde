import type { CourseSyncSnapshot, RelaySyncEnvelope, SyncOperationType } from '../models/types';
import { db } from '../db/database';

export const initialTime = '2026-01-01T10:00:00.000Z';

export const courseSnapshot = (): CourseSyncSnapshot => ({
  snapshotVersion: 1,
  exportedAt: initialTime,
  course: {
    syncId: 'course',
    updatedAt: initialTime,
    name: 'Höhenkurs',
    courseType: 'Höhenkurs',
    flightSchool: 'Testschule',
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    students: ['Anna', 'Ben'].map((name) => ({
      syncId: name,
      updatedAt: initialTime,
      name, glider: 'Alpha', color: 'Blau', totalFlights: 0, totalAltitudeMeters: 0, flightSchool: 'Testschule',
    })),
  },
  flights: [{
    syncId: 'flight',
    studentSyncId: 'Anna',
    updatedAt: initialTime,
    startTime: initialTime,
    maneuvers: ['Acht'],
    ratings: { Start: 8, Acht: 7, Landung: 0 },
    remarks: ['Ruhiger Start'],
    details: { startPlace: 'Berg', landPlace: 'Tal', startTeacher: 'Startlehrer', landTeacher: 'Landelehrer', altitudeDifferenceMeters: 850 },
  }],
});

export const privateCourseSnapshot = (): CourseSyncSnapshot => {
  const snapshot = courseSnapshot();
  return {
    ...snapshot,
    course: { ...snapshot.course, syncId: 'private-course', name: 'Private course' },
    flights: snapshot.flights.map((flight) => ({
      ...flight,
      syncId: `private-${flight.syncId}`,
      remarks: ['Private remarks'],
      details: { ...flight.details, startPlace: 'Private start' },
    })),
  };
};

export const syncDatabaseState = async () => ({
  courses: await db.courses.toArray(),
  students: await db.students.toArray(),
  flights: await db.flights.toArray(),
  syncEvents: await db.syncEvents.toArray(),
  receivedMessages: await db.receivedMessages.toArray(),
});

export const delta = (operation: SyncOperationType, payload: unknown, opTs = '2026-01-01T10:01:00.000Z'): RelaySyncEnvelope => ({
  version: 1, schemaVersion: 1, roomId: 'room', courseSyncId: 'course',
  deviceId: 'remote-device', opId: `${operation}-${opTs}`, opTs, operation, payload,
});
