import { db } from '../db/database';
import type { Course, Flight, RelaySyncEnvelope, Student } from '../models/types';
import {
  chooseStartWinner,
  deriveLandingPendingUntil,
  flightLifecycleRank,
  hasFinalizedFlightState,
  hasPendingLandingState,
  isDuplicateStartWindow,
  isOpenFlight,
  mergeManeuvers,
} from './flightConflict';
import { sanitizeFlightSchoolName } from './flightSchool';
import { isIncomingNewer } from './isIncomingNewer';

type CoursePayload = {
  syncId?: string;
  name?: string;
  courseType?: Course['courseType'];
  startDate?: string;
  endDate?: string;
  flightSchool?: string;
  updatedAt?: string;
  updatedByDeviceId?: string;
};

type StudentPayload = {
  syncId?: string;
  name?: string;
  glider?: string;
  color?: string;
  totalFlights?: number;
  totalAltitudeMeters?: number;
  flightSchool?: string;
  lastRatings?: Student['lastRatings'];
  photoDataUrl?: string | null;
  updatedAt?: string;
  updatedByDeviceId?: string;
};

type FlightPayload = {
  syncId?: string;
  studentSyncId?: string;
  studentId?: number;
  maneuvers?: string[];
  ratings?: Flight['ratings'] | null;
  remarks?: string[] | null;
  details?: Flight['details'] | null;
  startTime?: string;
  landingMarkedAt?: string | null;
  landingPendingUntil?: string | null;
  landingFinalizedAt?: string | null;
  endTime?: string | null;
  updatedAt?: string;
  updatedByDeviceId?: string;
};

const hasOwnPayloadField = <T extends object>(payload: T, field: keyof T): boolean => (
  Object.prototype.hasOwnProperty.call(payload, field)
);

const ensureCourseBySyncId = async (courseSyncId: string): Promise<Course | null> => {
  const existing = await db.courses.where('syncId').equals(courseSyncId).first();
  return existing ?? null;
};

const readUpdatedAt = (value: unknown): string | undefined => (
  typeof value === 'object' && value !== null && typeof (value as { updatedAt?: unknown }).updatedAt === 'string'
    ? (value as { updatedAt: string }).updatedAt
    : undefined
);

const hasNewerOrEqualFlightDelete = async (syncId: string, incomingUpdatedAt?: string): Promise<boolean> => {
  const deleteEvents = await db.syncEvents
    .where('entitySyncId')
    .equals(syncId)
    .filter((event) => event.operation === 'flight_delete')
    .toArray();

  return deleteEvents.some((event) => {
    const deletedAt = readUpdatedAt(event.payload) ?? event.opTs;
    if (!incomingUpdatedAt) return true;
    return Date.parse(deletedAt) >= Date.parse(incomingUpdatedAt);
  });
};

const chooseEarlierIso = (left?: string | null, right?: string | null): string | undefined => {
  if (!left) return right ?? undefined;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
};

const chooseLaterIso = (left?: string | null, right?: string | null): string | undefined => {
  if (!left) return right ?? undefined;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
};

const normalizeSameFlightUpdates = (payload: FlightPayload, existing: Flight, courseId: number, resolvedStudentId?: number): Partial<Flight> => {
  const incomingRank = flightLifecycleRank(payload);
  const existingRank = flightLifecycleRank(existing);
  const isLifecycleRegression = incomingRank < existingRank;
  const hasIncomingFinalized = hasFinalizedFlightState(payload);
  const hasIncomingPending = hasPendingLandingState(payload);
  const bothPending = existingRank === 2 && incomingRank === 2;
  const earliestLandingMarkedAt = bothPending
    ? chooseEarlierIso(existing.landingMarkedAt, payload.landingMarkedAt)
    : payload.landingMarkedAt ?? existing.landingMarkedAt;

  const updates: Partial<Flight> = {
    updatedAt: chooseLaterIso(payload.updatedAt, existing.updatedAt),
    updatedByDeviceId: payload.updatedByDeviceId ?? existing.updatedByDeviceId,
    courseId,
    studentId: resolvedStudentId ?? existing.studentId,
    maneuvers: hasOwnPayloadField(payload, 'maneuvers') ? mergeManeuvers(existing.maneuvers, payload.maneuvers) : existing.maneuvers,
    ratings: hasOwnPayloadField(payload, 'ratings') ? payload.ratings ?? undefined : existing.ratings,
    remarks: hasOwnPayloadField(payload, 'remarks') ? payload.remarks ? [...payload.remarks] : undefined : existing.remarks,
    details: hasOwnPayloadField(payload, 'details') ? payload.details ?? undefined : existing.details,
    startTime: payload.startTime ?? existing.startTime,
  };

  if (!isLifecycleRegression || hasIncomingFinalized) {
    updates.endTime = hasOwnPayloadField(payload, 'endTime') ? payload.endTime ?? undefined : existing.endTime;
    updates.landingFinalizedAt = hasOwnPayloadField(payload, 'landingFinalizedAt') ? payload.landingFinalizedAt ?? undefined : existing.landingFinalizedAt;
  } else {
    updates.endTime = existing.endTime;
    updates.landingFinalizedAt = existing.landingFinalizedAt;
  }

  if (hasIncomingFinalized) {
    updates.landingMarkedAt = hasOwnPayloadField(payload, 'landingMarkedAt') ? payload.landingMarkedAt ?? existing.landingMarkedAt : existing.landingMarkedAt;
    updates.landingPendingUntil = undefined;
    return updates;
  }

  if (bothPending) {
    updates.landingMarkedAt = earliestLandingMarkedAt;
    updates.landingPendingUntil = deriveLandingPendingUntil(earliestLandingMarkedAt)
      ?? chooseEarlierIso(existing.landingPendingUntil, payload.landingPendingUntil);
    updates.landingFinalizedAt = undefined;
    updates.endTime = undefined;
    return updates;
  }

  if (!isLifecycleRegression && hasIncomingPending) {
    updates.landingMarkedAt = hasOwnPayloadField(payload, 'landingMarkedAt') ? payload.landingMarkedAt ?? undefined : existing.landingMarkedAt;
    updates.landingPendingUntil = hasOwnPayloadField(payload, 'landingPendingUntil') ? payload.landingPendingUntil ?? undefined : existing.landingPendingUntil;
    updates.landingFinalizedAt = undefined;
    updates.endTime = undefined;
    return updates;
  }

  updates.landingMarkedAt = existing.landingMarkedAt;
  updates.landingPendingUntil = existing.landingPendingUntil;
  return updates;
};

const findDuplicateOpenFlightConflicts = async (
  courseId: number,
  studentId: number,
  incomingFlight: Pick<Flight, 'syncId' | 'startTime' | 'maneuvers' | 'endTime' | 'landingFinalizedAt'>,
): Promise<Flight[]> => {
  if (!isOpenFlight(incomingFlight)) return [];
  const courseFlights = await db.flights.where('courseId').equals(courseId).toArray();
  return courseFlights.filter((flight) => (
    flight.id
    && flight.studentId === studentId
    && flight.syncId !== incomingFlight.syncId
    && isOpenFlight(flight)
    && isDuplicateStartWindow(flight.startTime, incomingFlight.startTime)
  ));
};

const applyCourseUpsert = async (envelope: RelaySyncEnvelope): Promise<void> => {
  const payload = (envelope.payload ?? {}) as CoursePayload;
  const syncId = payload.syncId ?? envelope.courseSyncId;
  const existing = await ensureCourseBySyncId(syncId);

  if (!existing) {
    if (!payload.name || !payload.courseType || !payload.startDate || !payload.endDate || !payload.flightSchool) return;

    await db.courses.add({
      syncId,
      updatedAt: payload.updatedAt,
      updatedByDeviceId: payload.updatedByDeviceId,
      name: payload.name,
      courseType: payload.courseType,
      startDate: payload.startDate,
      endDate: payload.endDate,
      flightSchool: sanitizeFlightSchoolName(payload.flightSchool),
      students: [],
    });
    return;
  }

  if (!isIncomingNewer(payload.updatedAt, existing.updatedAt) || !existing.id) return;

  await db.courses.update(existing.id, {
    updatedAt: payload.updatedAt ?? existing.updatedAt,
    updatedByDeviceId: payload.updatedByDeviceId ?? existing.updatedByDeviceId,
    name: payload.name ?? existing.name,
    courseType: payload.courseType ?? existing.courseType,
    startDate: payload.startDate ?? existing.startDate,
    endDate: payload.endDate ?? existing.endDate,
    flightSchool: sanitizeFlightSchoolName(payload.flightSchool ?? existing.flightSchool),
  });
};

const applyStudentUpsert = async (envelope: RelaySyncEnvelope): Promise<void> => {
  const payload = (envelope.payload ?? {}) as StudentPayload;
  const studentSyncId = payload.syncId;
  if (!studentSyncId) return;
  const hasPhotoDataUrl = Object.prototype.hasOwnProperty.call(payload, 'photoDataUrl');

  const course = await ensureCourseBySyncId(envelope.courseSyncId);
  if (!course?.id) return;

  const existingStudent = await db.students.where('syncId').equals(studentSyncId).first();

  let resolvedStudent: Student | null = existingStudent ?? null;

  if (!existingStudent) {
    if (!payload.name || !payload.glider || !payload.color || typeof payload.totalFlights !== 'number' || !payload.flightSchool) {
      return;
    }

    const created: Student = {
      syncId: studentSyncId,
      updatedAt: payload.updatedAt,
      updatedByDeviceId: payload.updatedByDeviceId,
      name: payload.name,
      glider: payload.glider,
      color: payload.color,
      totalFlights: payload.totalFlights,
      totalAltitudeMeters: payload.totalAltitudeMeters ?? 0,
      flightSchool: sanitizeFlightSchoolName(payload.flightSchool),
      lastRatings: payload.lastRatings,
      photoDataUrl: payload.photoDataUrl ?? undefined,
    };

    const id = Number(await db.students.add(created));
    resolvedStudent = { ...created, id };
  } else if (isIncomingNewer(payload.updatedAt, existingStudent.updatedAt) && existingStudent.id) {
    const updates: Partial<Student> = {
      updatedAt: payload.updatedAt ?? existingStudent.updatedAt,
      updatedByDeviceId: payload.updatedByDeviceId ?? existingStudent.updatedByDeviceId,
      name: payload.name ?? existingStudent.name,
      glider: payload.glider ?? existingStudent.glider,
      color: payload.color ?? existingStudent.color,
      totalFlights: payload.totalFlights ?? existingStudent.totalFlights,
      totalAltitudeMeters: payload.totalAltitudeMeters ?? existingStudent.totalAltitudeMeters ?? 0,
      flightSchool: sanitizeFlightSchoolName(payload.flightSchool ?? existingStudent.flightSchool),
      lastRatings: payload.lastRatings ?? existingStudent.lastRatings,
      photoDataUrl: hasPhotoDataUrl ? payload.photoDataUrl ?? undefined : existingStudent.photoDataUrl,
    };

    await db.students.update(existingStudent.id, updates);
    resolvedStudent = { ...existingStudent, ...updates };
  }

  if (!resolvedStudent) return;

  const currentCourse = await db.courses.get(course.id);
  if (!currentCourse) return;

  const index = currentCourse.students.findIndex((student) => student.syncId === studentSyncId);
  const embedded = {
    ...resolvedStudent,
    id: resolvedStudent.id,
  };

  const nextStudents = [...currentCourse.students];
  if (index >= 0) {
    const currentEmbedded = nextStudents[index];
    if (!isIncomingNewer(payload.updatedAt, currentEmbedded.updatedAt)) return;
    nextStudents[index] = {
      ...currentEmbedded,
      ...embedded,
    };
  } else {
    nextStudents.push(embedded);
  }

  await db.courses.update(course.id, { students: nextStudents });
};

const applyStudentDelete = async (envelope: RelaySyncEnvelope): Promise<void> => {
  const syncId = String((envelope.payload as { syncId?: string })?.syncId ?? '');
  if (!syncId) return;

  const course = await ensureCourseBySyncId(envelope.courseSyncId);
  if (!course?.id) return;

  const currentCourse = await db.courses.get(course.id);
  if (!currentCourse) return;

  const nextStudents = currentCourse.students.filter((student) => student.syncId !== syncId);
  await db.courses.update(course.id, { students: nextStudents });
};

const applyFlightUpsert = async (envelope: RelaySyncEnvelope): Promise<void> => {
  const payload = (envelope.payload ?? {}) as FlightPayload;
  const syncId = payload.syncId;
  if (!syncId) return;

  if (await hasNewerOrEqualFlightDelete(syncId, payload.updatedAt)) return;

  const course = await ensureCourseBySyncId(envelope.courseSyncId);
  if (!course?.id) return;

  const existing = await db.flights.where('syncId').equals(syncId).first();

  let resolvedStudentId: number | undefined;

  if (payload.studentSyncId) {
    const student = await db.students.where('syncId').equals(payload.studentSyncId).first();
    resolvedStudentId = student?.id;
  }

  if (!resolvedStudentId && typeof payload.studentId === 'number') {
    const matchesCourseStudent = course.students.some((student) => student.id === payload.studentId);
    if (matchesCourseStudent) {
      resolvedStudentId = payload.studentId;
    }
  }

  if (!existing) {
    if (!resolvedStudentId || !payload.startTime) return;

    const incomingFlight: Flight = {
      syncId,
      updatedAt: payload.updatedAt,
      updatedByDeviceId: payload.updatedByDeviceId,
      courseId: course.id,
      studentId: resolvedStudentId,
      maneuvers: [...(payload.maneuvers ?? [])],
      ratings: payload.ratings ?? undefined,
      remarks: payload.remarks ? [...payload.remarks] : undefined,
      details: payload.details ?? undefined,
      startTime: payload.startTime,
      landingMarkedAt: payload.landingMarkedAt ?? undefined,
      landingPendingUntil: payload.landingPendingUntil ?? undefined,
      landingFinalizedAt: payload.landingFinalizedAt ?? undefined,
      endTime: payload.endTime ?? undefined,
    };

    const conflicts = await findDuplicateOpenFlightConflicts(course.id, resolvedStudentId, incomingFlight);
    if (conflicts.length > 0) {
      const candidates = [...conflicts, incomingFlight];
      const winner = chooseStartWinner(candidates);
      const mergedManeuvers = candidates.reduce<string[]>((current, candidate) => (
        mergeManeuvers(current, candidate.maneuvers)
      ), []);

      if (winner?.syncId === incomingFlight.syncId) {
        await db.flights.add({
          ...incomingFlight,
          maneuvers: mergedManeuvers,
        });

        await Promise.all(conflicts.map((conflict) => (
          conflict.id ? db.flights.delete(conflict.id) : Promise.resolve()
        )));
        return;
      }

      if (winner?.id) {
        await db.flights.update(winner.id, {
          maneuvers: mergedManeuvers,
          updatedAt: candidates.reduce<string | undefined>((current, candidate) => (
            chooseLaterIso(current, candidate.updatedAt)
          ), winner.updatedAt),
          updatedByDeviceId: candidates
            .slice()
            .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))[0]?.updatedByDeviceId ?? winner.updatedByDeviceId,
        });
      }
      return;
    }

    await db.flights.add(incomingFlight);
    return;
  }

  if (!existing.id) return;
  const isProgressingLifecycle = flightLifecycleRank(payload) > flightLifecycleRank(existing);
  if (!isProgressingLifecycle && !isIncomingNewer(payload.updatedAt, existing.updatedAt)) return;

  await db.flights.update(existing.id, normalizeSameFlightUpdates(payload, existing, course.id, resolvedStudentId));
};

const applyFlightDelete = async (envelope: RelaySyncEnvelope): Promise<void> => {
  const payload = (envelope.payload ?? {}) as FlightPayload;
  const syncId = payload.syncId;
  if (!syncId) return;

  const existing = await db.flights.where('syncId').equals(syncId).first();
  if (!existing?.id) return;

  // Only apply deletion if incoming is newer (prevents race conditions)
  if (!isIncomingNewer(payload.updatedAt, existing.updatedAt)) return;

  await db.flights.delete(existing.id);
};

export const applyRemoteDeltaEnvelope = async (envelope: RelaySyncEnvelope): Promise<void> => {
  switch (envelope.operation) {
    case 'course_upsert':
      await applyCourseUpsert(envelope);
      return;
    case 'student_upsert':
      await applyStudentUpsert(envelope);
      return;
    case 'student_delete':
      await applyStudentDelete(envelope);
      return;
    case 'flight_upsert':
      await applyFlightUpsert(envelope);
      return;
    case 'flight_delete':
      await applyFlightDelete(envelope);
      return;
    default:
      return;
  }
};
