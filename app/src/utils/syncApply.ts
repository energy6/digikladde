import { db } from '../db/database';
import type { Course, Flight, RelaySyncEnvelope, Student } from '../models/types';
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
  flightSchool?: string;
  updatedAt?: string;
  updatedByDeviceId?: string;
};

type FlightPayload = {
  syncId?: string;
  studentSyncId?: string;
  studentId?: number;
  maneuvers?: string[];
  remarks?: string[];
  details?: Flight['details'];
  startTime?: string;
  landingMarkedAt?: string;
  landingPendingUntil?: string;
  landingFinalizedAt?: string;
  endTime?: string;
  updatedAt?: string;
  updatedByDeviceId?: string;
};

const ensureCourseBySyncId = async (courseSyncId: string): Promise<Course | null> => {
  const existing = await db.courses.where('syncId').equals(courseSyncId).first();
  return existing ?? null;
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
      flightSchool: sanitizeFlightSchoolName(payload.flightSchool),
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
      flightSchool: sanitizeFlightSchoolName(payload.flightSchool ?? existingStudent.flightSchool),
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

    await db.flights.add({
      syncId,
      updatedAt: payload.updatedAt,
      updatedByDeviceId: payload.updatedByDeviceId,
      courseId: course.id,
      studentId: resolvedStudentId,
      maneuvers: [...(payload.maneuvers ?? [])],
      remarks: payload.remarks ? [...payload.remarks] : undefined,
      details: payload.details,
      startTime: payload.startTime,
      landingMarkedAt: payload.landingMarkedAt,
      landingPendingUntil: payload.landingPendingUntil,
      landingFinalizedAt: payload.landingFinalizedAt,
      endTime: payload.endTime,
    });
    return;
  }

  if (!isIncomingNewer(payload.updatedAt, existing.updatedAt) || !existing.id) return;

  await db.flights.update(existing.id, {
    updatedAt: payload.updatedAt ?? existing.updatedAt,
    updatedByDeviceId: payload.updatedByDeviceId ?? existing.updatedByDeviceId,
    courseId: course.id,
    studentId: resolvedStudentId ?? existing.studentId,
    maneuvers: payload.maneuvers ? [...payload.maneuvers] : existing.maneuvers,
    remarks: payload.remarks ? [...payload.remarks] : existing.remarks,
    details: payload.details ?? existing.details,
    startTime: payload.startTime ?? existing.startTime,
    landingMarkedAt: payload.landingMarkedAt ?? existing.landingMarkedAt,
    landingPendingUntil: payload.landingPendingUntil ?? existing.landingPendingUntil,
    landingFinalizedAt: payload.landingFinalizedAt ?? existing.landingFinalizedAt,
    endTime: payload.endTime ?? existing.endTime,
  });
};

const applyFlightDelete = async (envelope: RelaySyncEnvelope): Promise<void> => {
  const syncId = String((envelope.payload as { syncId?: string })?.syncId ?? '');
  if (!syncId) return;

  const existing = await db.flights.where('syncId').equals(syncId).first();
  if (!existing?.id) return;

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
