import Dexie, { type Table } from 'dexie';
import type { Course, Flight, ShareSession, Student, SyncEvent } from '../models/types';
import { sanitizeFlightSchoolName } from '../utils/flightSchool';

export class DigiKladdeDB extends Dexie {
  courses!: Table<Course>;
  students!: Table<Student>;
  flights!: Table<Flight>;
  syncEvents!: Table<SyncEvent>;
  shareSessions!: Table<ShareSession>;

  private createSyncId(prefix: string): string {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  constructor() {
    super('DigiKladdeDB');
    this.version(1).stores({
      courses: '++id, name, startDate, endDate',
      students: '++id, name, glider, color',
      flights: '++id, courseId, studentId, startTime, endTime',
    });
    this.version(2).stores({
      courses: '++id, name, startDate, endDate',
      students: '++id, name, glider, color',
      flights: '++id, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt',
    });
    this.version(3)
      .stores({
        courses: '++id, name, startDate, endDate, flightSchool',
        students: '++id, name, glider, color, flightSchool',
        flights: '++id, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt',
      })
      .upgrade(async (tx) => {
        await tx.table<Course>('courses').toCollection().modify((course) => {
          const nextSchool = sanitizeFlightSchoolName(course.flightSchool);
          const nextStudents = (course.students ?? []).map((student) => ({
            ...student,
            flightSchool: sanitizeFlightSchoolName(student.flightSchool ?? nextSchool),
          }));

          course.flightSchool = nextSchool;
          course.students = nextStudents;
        });

        await tx.table<Student>('students').toCollection().modify((student) => {
          student.flightSchool = sanitizeFlightSchoolName(student.flightSchool);
        });
      });

    this.version(4)
      .stores({
        courses: '++id, syncId, name, startDate, endDate, flightSchool, updatedAt',
        students: '++id, syncId, name, glider, color, flightSchool, updatedAt',
        flights: '++id, syncId, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt, updatedAt',
        syncEvents: '++id, &opId, roomId, courseSyncId, entityType, entitySyncId, opTs, operation, deviceId',
        shareSessions: '++id, courseSyncId, roomId, state, updatedAt, [roomId+courseSyncId]',
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();

        await tx.table<Course>('courses').toCollection().modify((course) => {
          course.syncId = course.syncId ?? this.createSyncId('course');
          course.updatedAt = course.updatedAt ?? now;
          course.updatedByDeviceId = course.updatedByDeviceId ?? 'local-device';

          const nextSchool = sanitizeFlightSchoolName(course.flightSchool);
          course.flightSchool = nextSchool;
          course.students = (course.students ?? []).map((student) => ({
            ...student,
            syncId: student.syncId ?? this.createSyncId('student'),
            updatedAt: student.updatedAt ?? now,
            updatedByDeviceId: student.updatedByDeviceId ?? 'local-device',
            flightSchool: sanitizeFlightSchoolName(student.flightSchool ?? nextSchool),
          }));
        });

        await tx.table<Student>('students').toCollection().modify((student) => {
          student.syncId = student.syncId ?? this.createSyncId('student');
          student.updatedAt = student.updatedAt ?? now;
          student.updatedByDeviceId = student.updatedByDeviceId ?? 'local-device';
          student.flightSchool = sanitizeFlightSchoolName(student.flightSchool);
        });

        await tx.table<Flight>('flights').toCollection().modify((flight) => {
          flight.syncId = flight.syncId ?? this.createSyncId('flight');
          flight.updatedAt = flight.updatedAt ?? now;
          flight.updatedByDeviceId = flight.updatedByDeviceId ?? 'local-device';
        });
      });

    this.version(5).stores({
      courses: '++id, syncId, name, startDate, endDate, flightSchool, updatedAt',
      students: '++id, syncId, name, glider, color, flightSchool, updatedAt',
      flights: '++id, syncId, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt, updatedAt',
      syncEvents: '++id, &opId, roomId, courseSyncId, entityType, entitySyncId, opTs, operation, deviceId',
      shareSessions: '++id, courseSyncId, roomId, state, updatedAt, [roomId+courseSyncId]',
    });
  }
}

export const db = new DigiKladdeDB();
