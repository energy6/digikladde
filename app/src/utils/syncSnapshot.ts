import { db } from '../db/database';
import type {
    Course,
    CourseSyncSnapshot,
    Flight,
    SharedFlightSnapshot,
    SharedStudentSnapshot,
    Student,
} from '../models/types';
import { sanitizeFlightSchoolName } from './flightSchool';
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
import { createId } from './idGenerator';
import { isIncomingNewer } from './isIncomingNewer';

const ensureCourseSyncId = async (course: Course, deviceId: string, now: string): Promise<string> => {
  if (course.syncId) return course.syncId;

  const syncId = createId('course');
  if (course.id) {
    await db.courses.update(course.id, {
      syncId,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    });
  }

  return syncId;
};

const ensureStudentSnapshotSyncIds = async (
  course: Course,
  deviceId: string,
  now: string,
): Promise<SharedStudentSnapshot[]> => {
  const nextStudents: SharedStudentSnapshot[] = [];
  let changed = false;

  for (const student of course.students ?? []) {
    const syncId = student.syncId ?? createId('student');
    const nextStudent: SharedStudentSnapshot = {
      syncId,
      updatedAt: student.updatedAt ?? now,
      updatedByDeviceId: student.updatedByDeviceId ?? deviceId,
      name: student.name,
      glider: student.glider,
      color: student.color,
      totalFlights: student.totalFlights ?? 0,
      flightSchool: sanitizeFlightSchoolName(student.flightSchool ?? course.flightSchool),
      lastRatings: student.lastRatings,
      photoDataUrl: student.photoDataUrl,
    };

    if (!student.syncId || !student.updatedAt || !student.updatedByDeviceId) {
      changed = true;
    }

    nextStudents.push(nextStudent);
  }

  if (changed && course.id) {
    await db.courses.update(course.id, {
      students: nextStudents,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    });
  }

  return nextStudents;
};

const ensureFlightsSyncIds = async (
  flights: Flight[],
  studentSyncIdByLocalId: Map<number, string>,
  deviceId: string,
  now: string,
): Promise<SharedFlightSnapshot[]> => {
  const snapshots: SharedFlightSnapshot[] = [];

  for (const flight of flights) {
    const syncId = flight.syncId ?? createId('flight');

    if ((!flight.syncId || !flight.updatedAt || !flight.updatedByDeviceId) && flight.id) {
      await db.flights.update(flight.id, {
        syncId,
        updatedAt: now,
        updatedByDeviceId: deviceId,
      });
    }

    const student = await db.students.get(flight.studentId);
    const studentSyncId = student?.syncId ?? studentSyncIdByLocalId.get(flight.studentId) ?? `student_local_${flight.studentId}`;

    snapshots.push({
      syncId,
      studentSyncId,
      updatedAt: flight.updatedAt ?? now,
      updatedByDeviceId: flight.updatedByDeviceId ?? deviceId,
      maneuvers: [...(flight.maneuvers ?? [])],
      ratings: flight.ratings,
      remarks: flight.remarks ? [...flight.remarks] : undefined,
      details: flight.details,
      startTime: flight.startTime,
      landingMarkedAt: flight.landingMarkedAt,
      landingPendingUntil: flight.landingPendingUntil,
      landingFinalizedAt: flight.landingFinalizedAt,
      endTime: flight.endTime,
    });
  }

  return snapshots;
};

export const exportCourseSnapshot = async (
  courseId: number,
  roomId?: string,
  deviceId = 'local-device',
): Promise<CourseSyncSnapshot> => {
  const course = await db.courses.get(courseId);
  if (!course || !course.id) {
    throw new Error('Kurs nicht gefunden.');
  }

  const now = new Date().toISOString();
  const courseSyncId = await ensureCourseSyncId(course, deviceId, now);
  const studentSnapshots = await ensureStudentSnapshotSyncIds(course, deviceId, now);
  const flights = await db.flights.where('courseId').equals(course.id).toArray();
  const studentSyncIdByLocalId = new Map(
    studentSnapshots
      .map((student, index) => {
        const localId = course.students[index]?.id;
        return typeof localId === 'number' ? [localId, student.syncId] as const : null;
      })
      .filter((entry): entry is readonly [number, string] => entry !== null),
  );
  const flightSnapshots = await ensureFlightsSyncIds(flights, studentSyncIdByLocalId, deviceId, now);

  return {
    snapshotVersion: 1,
    exportedAt: now,
    roomId,
    course: {
      syncId: courseSyncId,
      updatedAt: course.updatedAt ?? now,
      updatedByDeviceId: course.updatedByDeviceId ?? deviceId,
      name: course.name,
      courseType: course.courseType,
      startDate: course.startDate,
      endDate: course.endDate,
      flightSchool: sanitizeFlightSchoolName(course.flightSchool),
      flightDefaults: course.flightDefaults,
      students: studentSnapshots,
    },
    flights: flightSnapshots,
  };
};

const upsertStudentBySyncId = async (
  snapshotStudent: SharedStudentSnapshot,
  deviceId: string,
): Promise<Student> => {
  const existing = await db.students.where('syncId').equals(snapshotStudent.syncId).first();
  const incomingFlightSchool = sanitizeFlightSchoolName(snapshotStudent.flightSchool);

  if (!existing) {
    const insert: Student = {
      syncId: snapshotStudent.syncId,
      updatedAt: snapshotStudent.updatedAt ?? new Date().toISOString(),
      updatedByDeviceId: snapshotStudent.updatedByDeviceId ?? deviceId,
      name: snapshotStudent.name,
      glider: snapshotStudent.glider,
      color: snapshotStudent.color,
      totalFlights: snapshotStudent.totalFlights,
      flightSchool: incomingFlightSchool,
      lastRatings: snapshotStudent.lastRatings,
      photoDataUrl: snapshotStudent.photoDataUrl,
    };

    const id = Number(await db.students.add(insert));
    return { ...insert, id };
  }

  if (!isIncomingNewer(snapshotStudent.updatedAt, existing.updatedAt)) {
    return existing;
  }

  const updates: Partial<Student> = {
    updatedAt: snapshotStudent.updatedAt ?? existing.updatedAt,
    updatedByDeviceId: snapshotStudent.updatedByDeviceId ?? existing.updatedByDeviceId,
    name: snapshotStudent.name,
    glider: snapshotStudent.glider,
    color: snapshotStudent.color,
    totalFlights: snapshotStudent.totalFlights,
    flightSchool: incomingFlightSchool,
    lastRatings: snapshotStudent.lastRatings ?? existing.lastRatings,
    photoDataUrl: snapshotStudent.photoDataUrl,
  };

  if (existing.id) {
    await db.students.update(existing.id, updates);
  }

  return { ...existing, ...updates };
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

const chooseLaterIso = (left?: string, right?: string): string | undefined => {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
};

const chooseEarlierIso = (left?: string, right?: string): string | undefined => {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
};

const normalizeSnapshotFlightUpdates = (
  incomingFlight: SharedFlightSnapshot,
  existingFlight: Flight,
  localCourseId: number,
  studentId: number,
): Partial<Flight> => {
  const incomingRank = flightLifecycleRank(incomingFlight);
  const existingRank = flightLifecycleRank(existingFlight);
  const isRegression = incomingRank < existingRank;
  const bothPending = existingRank === 2 && incomingRank === 2;
  const earliestLandingMarkedAt = bothPending
    ? chooseEarlierIso(existingFlight.landingMarkedAt, incomingFlight.landingMarkedAt)
    : incomingFlight.landingMarkedAt ?? existingFlight.landingMarkedAt;

  const updates: Partial<Flight> = {
    updatedAt: chooseLaterIso(incomingFlight.updatedAt, existingFlight.updatedAt),
    updatedByDeviceId: incomingFlight.updatedByDeviceId ?? existingFlight.updatedByDeviceId,
    courseId: localCourseId,
    studentId,
    maneuvers: mergeManeuvers(existingFlight.maneuvers, incomingFlight.maneuvers),
    ratings: incomingFlight.ratings,
    remarks: incomingFlight.remarks ? [...incomingFlight.remarks] : undefined,
    details: incomingFlight.details,
    startTime: incomingFlight.startTime,
  };

  if (!isRegression || hasFinalizedFlightState(incomingFlight)) {
    updates.endTime = incomingFlight.endTime;
    updates.landingFinalizedAt = incomingFlight.landingFinalizedAt;
  } else {
    updates.endTime = existingFlight.endTime;
    updates.landingFinalizedAt = existingFlight.landingFinalizedAt;
  }

  if (hasFinalizedFlightState(incomingFlight)) {
    updates.landingMarkedAt = incomingFlight.landingMarkedAt ?? existingFlight.landingMarkedAt;
    updates.landingPendingUntil = undefined;
    return updates;
  }

  if (bothPending) {
    updates.landingMarkedAt = earliestLandingMarkedAt;
    updates.landingPendingUntil = deriveLandingPendingUntil(earliestLandingMarkedAt)
      ?? chooseEarlierIso(existingFlight.landingPendingUntil, incomingFlight.landingPendingUntil);
    updates.endTime = undefined;
    updates.landingFinalizedAt = undefined;
    return updates;
  }

  if (!isRegression && hasPendingLandingState(incomingFlight)) {
    updates.landingMarkedAt = incomingFlight.landingMarkedAt;
    updates.landingPendingUntil = incomingFlight.landingPendingUntil;
    updates.endTime = undefined;
    updates.landingFinalizedAt = undefined;
    return updates;
  }

  updates.landingMarkedAt = existingFlight.landingMarkedAt;
  updates.landingPendingUntil = existingFlight.landingPendingUntil;
  return updates;
};

export const importCourseSnapshot = async (
  snapshot: CourseSyncSnapshot,
  deviceId = 'local-device',
): Promise<{ courseId: number; importedFlights: number; importedStudents: number }> => {
  const now = new Date().toISOString();
  const incomingCourse = snapshot.course;

  return db.transaction('rw', db.courses, db.students, db.flights, db.syncEvents, async () => {
    const studentMap = new Map<string, Student>();

    for (const student of incomingCourse.students) {
      const upserted = await upsertStudentBySyncId(student, deviceId);
      studentMap.set(student.syncId, upserted);
    }

    const embeddedStudents: Student[] = incomingCourse.students.map((student) => {
      const resolved = studentMap.get(student.syncId);
      return {
        id: resolved?.id,
        syncId: student.syncId,
        updatedAt: resolved?.updatedAt ?? student.updatedAt ?? now,
        updatedByDeviceId: resolved?.updatedByDeviceId ?? student.updatedByDeviceId ?? deviceId,
        name: resolved?.name ?? student.name,
        glider: resolved?.glider ?? student.glider,
        color: resolved?.color ?? student.color,
        totalFlights: resolved?.totalFlights ?? student.totalFlights,
        flightSchool: sanitizeFlightSchoolName(resolved?.flightSchool ?? student.flightSchool),
        lastRatings: resolved?.lastRatings ?? student.lastRatings,
        photoDataUrl: resolved?.photoDataUrl ?? student.photoDataUrl,
      };
    });

    const existingCourse = await db.courses.where('syncId').equals(incomingCourse.syncId).first();

    let localCourseId: number;
    if (!existingCourse) {
      const insert: Course = {
        syncId: incomingCourse.syncId,
        updatedAt: incomingCourse.updatedAt ?? now,
        updatedByDeviceId: incomingCourse.updatedByDeviceId ?? deviceId,
        name: incomingCourse.name,
        courseType: incomingCourse.courseType,
        startDate: incomingCourse.startDate,
        endDate: incomingCourse.endDate,
        flightSchool: sanitizeFlightSchoolName(incomingCourse.flightSchool),
        students: embeddedStudents,
        flightDefaults: incomingCourse.flightDefaults,
      };

      localCourseId = Number(await db.courses.add(insert));
    } else {
      localCourseId = Number(existingCourse.id);
      const isJoinPlaceholder = existingCourse.name === 'Geteilter Kurs' && (existingCourse.students?.length ?? 0) === 0;
      const shouldApplySnapshot = isJoinPlaceholder || isIncomingNewer(incomingCourse.updatedAt, existingCourse.updatedAt);

      if (shouldApplySnapshot) {
        await db.courses.update(localCourseId, {
          updatedAt: incomingCourse.updatedAt ?? existingCourse.updatedAt,
          updatedByDeviceId: incomingCourse.updatedByDeviceId ?? existingCourse.updatedByDeviceId,
          name: incomingCourse.name,
          courseType: incomingCourse.courseType,
          startDate: incomingCourse.startDate,
          endDate: incomingCourse.endDate,
          flightSchool: sanitizeFlightSchoolName(incomingCourse.flightSchool),
          students: embeddedStudents,
          flightDefaults: incomingCourse.flightDefaults,
        });
      }
    }

    let importedFlights = 0;

    for (const incomingFlight of snapshot.flights) {
      const resolvedStudent = studentMap.get(incomingFlight.studentSyncId);
      if (!resolvedStudent?.id) continue;
      if (await hasNewerOrEqualFlightDelete(incomingFlight.syncId, incomingFlight.updatedAt)) continue;

      const existingFlight = await db.flights.where('syncId').equals(incomingFlight.syncId).first();

      if (!existingFlight) {
        const incomingInsert: Flight = {
          syncId: incomingFlight.syncId,
          updatedAt: incomingFlight.updatedAt ?? now,
          updatedByDeviceId: incomingFlight.updatedByDeviceId ?? deviceId,
          courseId: localCourseId,
          studentId: resolvedStudent.id,
          maneuvers: [...(incomingFlight.maneuvers ?? [])],
          ratings: incomingFlight.ratings,
          remarks: incomingFlight.remarks ? [...incomingFlight.remarks] : undefined,
          details: incomingFlight.details,
          startTime: incomingFlight.startTime,
          landingMarkedAt: incomingFlight.landingMarkedAt,
          landingPendingUntil: incomingFlight.landingPendingUntil,
          landingFinalizedAt: incomingFlight.landingFinalizedAt,
          endTime: incomingFlight.endTime,
        };
        const conflictFlights = isOpenFlight(incomingInsert)
          ? (await db.flights.where('courseId').equals(localCourseId).toArray()).filter((flight) => (
            flight.id
            && flight.studentId === resolvedStudent.id
            && flight.syncId !== incomingInsert.syncId
            && isOpenFlight(flight)
            && isDuplicateStartWindow(flight.startTime, incomingInsert.startTime)
          ))
          : [];

        if (conflictFlights.length > 0) {
          const candidates = [...conflictFlights, incomingInsert];
          const winner = chooseStartWinner(candidates);
          const mergedManeuvers = candidates.reduce<string[]>((current, candidate) => (
            mergeManeuvers(current, candidate.maneuvers)
          ), []);
          const mergedUpdatedAt = candidates.reduce<string | undefined>((current, candidate) => (
            chooseLaterIso(current, candidate.updatedAt)
          ), winner?.updatedAt);

          if (winner?.syncId === incomingInsert.syncId) {
            await db.flights.add({
              ...incomingInsert,
              maneuvers: mergedManeuvers,
              updatedAt: mergedUpdatedAt ?? incomingInsert.updatedAt,
            });
            await Promise.all(conflictFlights.map((flight) => (
              flight.id ? db.flights.delete(flight.id) : Promise.resolve()
            )));
            importedFlights += 1;
          } else if (winner?.id) {
            await db.flights.update(winner.id, {
              maneuvers: mergedManeuvers,
              updatedAt: mergedUpdatedAt ?? winner.updatedAt,
            });
          }
          continue;
        }

        const insert: Flight = {
          syncId: incomingFlight.syncId,
          updatedAt: incomingFlight.updatedAt ?? now,
          updatedByDeviceId: incomingFlight.updatedByDeviceId ?? deviceId,
          courseId: localCourseId,
          studentId: resolvedStudent.id,
          maneuvers: [...(incomingFlight.maneuvers ?? [])],
          ratings: incomingFlight.ratings,
          remarks: incomingFlight.remarks ? [...incomingFlight.remarks] : undefined,
          details: incomingFlight.details,
          startTime: incomingFlight.startTime,
          landingMarkedAt: incomingFlight.landingMarkedAt,
          landingPendingUntil: incomingFlight.landingPendingUntil,
          landingFinalizedAt: incomingFlight.landingFinalizedAt,
          endTime: incomingFlight.endTime,
        };

        await db.flights.add(insert);
        importedFlights += 1;
        continue;
      }

      const isProgressingLifecycle = flightLifecycleRank(incomingFlight) > flightLifecycleRank(existingFlight);
      if (!isProgressingLifecycle && !isIncomingNewer(incomingFlight.updatedAt, existingFlight.updatedAt)) {
        continue;
      }

      await db.flights.update(Number(existingFlight.id), normalizeSnapshotFlightUpdates(
        incomingFlight,
        existingFlight,
        localCourseId,
        resolvedStudent.id,
      ));
      importedFlights += 1;
    }

    return {
      courseId: localCourseId,
      importedFlights,
      importedStudents: studentMap.size,
    };
  });
};
