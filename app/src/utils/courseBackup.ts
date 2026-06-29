import { db } from '../db/database';
import type {
  Course,
  CourseBackupEnvelope,
  CourseSyncSnapshot,
  CourseType,
  Flight,
  SharedFlightSnapshot,
  SharedStudentSnapshot,
  Student,
} from '../models/types';
import { courseTypes } from '../models/types';
import { sanitizeFlightSchoolName } from './flightSchool';
import { createId } from './idGenerator';
import { exportCourseSnapshot } from './syncSnapshot';

export const courseBackupKind = 'digikladde.course-backup';
export const courseBackupFormatVersion = 1;

export type CourseBackupImportResult = {
  courseId: number;
  importedStudents: number;
  importedFlights: number;
};

export class CourseBackupError extends Error {
  readonly code: 'invalid_json' | 'invalid_format' | 'unsupported_version' | 'invalid_snapshot' | 'import_failed';

  constructor(
    message: string,
    code: 'invalid_json' | 'invalid_format' | 'unsupported_version' | 'invalid_snapshot' | 'import_failed',
  ) {
    super(message);
    this.name = 'CourseBackupError';
    this.code = code;
  }
}

type CourseBackupCopyRecords = {
  course: Course;
  students: Student[];
  flights: Flight[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const isString = (value: unknown): value is string => typeof value === 'string';

const isOptionalString = (value: unknown): value is string | undefined => (
  value === undefined || isString(value)
);

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every(isString)
);

const isCourseType = (value: unknown): value is CourseType => (
  isString(value) && courseTypes.includes(value as CourseType)
);

const assertSharedStudentSnapshot = (value: unknown, index: number): SharedStudentSnapshot => {
  if (!isRecord(value)) {
    throw new CourseBackupError(`Schueler ${index + 1} ist ungueltig.`, 'invalid_snapshot');
  }

  if (
    !isString(value.syncId)
    || !isString(value.name)
    || !isString(value.glider)
    || !isString(value.color)
    || typeof value.totalFlights !== 'number'
    || !isString(value.flightSchool)
    || !isOptionalString(value.updatedAt)
    || !isOptionalString(value.updatedByDeviceId)
  ) {
    throw new CourseBackupError(`Schueler ${index + 1} enthaelt unvollstaendige Pflichtdaten.`, 'invalid_snapshot');
  }

  return value as unknown as SharedStudentSnapshot;
};

const assertSharedFlightSnapshot = (value: unknown, index: number): SharedFlightSnapshot => {
  if (!isRecord(value)) {
    throw new CourseBackupError(`Flug ${index + 1} ist ungueltig.`, 'invalid_snapshot');
  }

  if (
    !isString(value.syncId)
    || !isString(value.studentSyncId)
    || !isString(value.startTime)
    || !isStringArray(value.maneuvers)
    || !isOptionalString(value.updatedAt)
    || !isOptionalString(value.updatedByDeviceId)
    || !isOptionalString(value.landingMarkedAt)
    || !isOptionalString(value.landingPendingUntil)
    || !isOptionalString(value.landingFinalizedAt)
    || !isOptionalString(value.endTime)
  ) {
    throw new CourseBackupError(`Flug ${index + 1} enthaelt unvollstaendige Pflichtdaten.`, 'invalid_snapshot');
  }

  return value as unknown as SharedFlightSnapshot;
};

export const assertCourseSyncSnapshot = (value: unknown): CourseSyncSnapshot => {
  if (!isRecord(value)) {
    throw new CourseBackupError('Backup enthaelt keinen gueltigen Kurs-Snapshot.', 'invalid_snapshot');
  }

  const course = value.course;
  if (
    value.snapshotVersion !== 1
    || !isString(value.exportedAt)
    || !isRecord(course)
    || !Array.isArray(value.flights)
    || !isString(course.syncId)
    || !isString(course.name)
    || !isCourseType(course.courseType)
    || !isString(course.startDate)
    || !isString(course.endDate)
    || !isString(course.flightSchool)
    || !Array.isArray(course.students)
  ) {
    throw new CourseBackupError('Backup enthaelt unvollstaendige Kursdaten.', 'invalid_snapshot');
  }

  const students = course.students.map(assertSharedStudentSnapshot);
  const studentSyncIds = new Set(students.map((student) => student.syncId));
  const flights = value.flights.map(assertSharedFlightSnapshot);

  for (const flight of flights) {
    if (!studentSyncIds.has(flight.studentSyncId)) {
      throw new CourseBackupError('Backup enthaelt Fluege mit unbekannten Schuelern.', 'invalid_snapshot');
    }
  }

  return {
    ...(value as unknown as CourseSyncSnapshot),
    course: {
      ...(course as unknown as CourseSyncSnapshot['course']),
      students: students.map((student) => ({
        ...student,
        totalAltitudeMeters: student.totalAltitudeMeters ?? 0,
      })),
    },
    flights,
  };
};

export const createCourseBackupEnvelope = (
  snapshot: CourseSyncSnapshot,
  appVersion?: string,
): CourseBackupEnvelope => ({
  kind: courseBackupKind,
  formatVersion: courseBackupFormatVersion,
  exportedAt: new Date().toISOString(),
  appVersion,
  snapshot: assertCourseSyncSnapshot(snapshot),
});

export const serializeCourseBackup = (backup: CourseBackupEnvelope): string => (
  `${JSON.stringify(backup, null, 2)}\n`
);

export const parseCourseBackup = (rawValue: string): CourseBackupEnvelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new CourseBackupError('Datei ist kein gueltiges JSON.', 'invalid_json');
  }

  if (!isRecord(parsed) || parsed.kind !== courseBackupKind || typeof parsed.formatVersion !== 'number') {
    throw new CourseBackupError('Datei ist kein DigiKladde-Kursbackup.', 'invalid_format');
  }

  if (parsed.formatVersion !== courseBackupFormatVersion) {
    throw new CourseBackupError('Backup-Version wird von dieser App nicht unterstuetzt.', 'unsupported_version');
  }

  if (!isString(parsed.exportedAt)) {
    throw new CourseBackupError('Backup enthaelt kein gueltiges Exportdatum.', 'invalid_format');
  }

  return {
    kind: courseBackupKind,
    formatVersion: courseBackupFormatVersion,
    exportedAt: parsed.exportedAt,
    appVersion: isString(parsed.appVersion) ? parsed.appVersion : undefined,
    snapshot: assertCourseSyncSnapshot(parsed.snapshot),
  };
};

export const buildCourseBackupCopyRecords = (
  snapshot: CourseSyncSnapshot,
  deviceId = 'local-device',
  now = new Date().toISOString(),
): CourseBackupCopyRecords => {
  const validatedSnapshot = assertCourseSyncSnapshot(snapshot);
  const studentSyncIdMap = new Map<string, Student>();

  const students: Student[] = validatedSnapshot.course.students.map((student) => {
    const copy: Student = {
      syncId: createId('student'),
      updatedAt: now,
      updatedByDeviceId: deviceId,
      name: student.name,
      glider: student.glider,
      color: student.color,
      totalFlights: student.totalFlights,
      totalAltitudeMeters: student.totalAltitudeMeters ?? 0,
      flightSchool: sanitizeFlightSchoolName(student.flightSchool),
      lastRatings: student.lastRatings,
      photoDataUrl: student.photoDataUrl,
    };
    studentSyncIdMap.set(student.syncId, copy);
    return copy;
  });

  const course: Course = {
    syncId: createId('course'),
    updatedAt: now,
    updatedByDeviceId: deviceId,
    name: validatedSnapshot.course.name,
    courseType: validatedSnapshot.course.courseType,
    startDate: validatedSnapshot.course.startDate,
    endDate: validatedSnapshot.course.endDate,
    flightSchool: sanitizeFlightSchoolName(validatedSnapshot.course.flightSchool),
    students,
    flightDefaults: validatedSnapshot.course.flightDefaults,
  };

  const flights = validatedSnapshot.flights.map((flight) => {
    const student = studentSyncIdMap.get(flight.studentSyncId);
    if (!student) {
      throw new CourseBackupError('Backup enthaelt Fluege mit unbekannten Schuelern.', 'invalid_snapshot');
    }

    return {
      syncId: createId('flight'),
      updatedAt: now,
      updatedByDeviceId: deviceId,
      courseId: 0,
      studentId: 0,
      maneuvers: [...flight.maneuvers],
      ratings: flight.ratings,
      remarks: flight.remarks ? [...flight.remarks] : undefined,
      details: flight.details,
      startTime: flight.startTime,
      landingMarkedAt: flight.landingMarkedAt,
      landingPendingUntil: flight.landingPendingUntil,
      landingFinalizedAt: flight.landingFinalizedAt,
      endTime: flight.endTime,
    } satisfies Flight;
  });

  return { course, students, flights };
};

export const exportCourseBackup = async (
  courseId: number,
  deviceId = 'local-device',
  appVersion?: string,
): Promise<CourseBackupEnvelope> => {
  const snapshot = await exportCourseSnapshot(courseId, undefined, deviceId);
  return createCourseBackupEnvelope(snapshot, appVersion);
};

export const importCourseBackupCopy = async (
  backup: CourseBackupEnvelope,
  deviceId = 'local-device',
): Promise<CourseBackupImportResult> => {
  const records = buildCourseBackupCopyRecords(backup.snapshot, deviceId);

  try {
    return await db.transaction('rw', db.courses, db.students, db.flights, async () => {
      const studentIdByIndex = new Map<number, number>();
      const embeddedStudents: Student[] = [];

      for (const [index, student] of records.students.entries()) {
        const studentId = Number(await db.students.add(student));
        studentIdByIndex.set(index, studentId);
        embeddedStudents.push({ ...student, id: studentId });
      }

      const courseId = Number(await db.courses.add({
        ...records.course,
        students: embeddedStudents,
      }));

      for (const [index, flight] of records.flights.entries()) {
        const studentId = studentIdByIndex.get(
          backup.snapshot.course.students.findIndex((student) => student.syncId === backup.snapshot.flights[index].studentSyncId),
        );

        if (!studentId) {
          throw new CourseBackupError('Backup enthaelt Fluege mit unbekannten Schuelern.', 'invalid_snapshot');
        }

        await db.flights.add({
          ...flight,
          courseId,
          studentId,
        });
      }

      return {
        courseId,
        importedStudents: embeddedStudents.length,
        importedFlights: records.flights.length,
      };
    });
  } catch (error) {
    if (error instanceof CourseBackupError) throw error;
    throw new CourseBackupError('Kursbackup konnte nicht importiert werden.', 'import_failed');
  }
};

export const buildCourseBackupFilename = (course: Course): string => {
  const safeName = course.name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80) || 'Kurs';
  const date = course.startDate ? course.startDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `DigiKladde_${safeName}_${date}.digikladde.json`;
};
