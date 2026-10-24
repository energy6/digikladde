import { z } from 'zod';
import type { CourseSyncSnapshot, RelaySyncEnvelope } from '../models/types';

const text = z.string();
const id = text.min(1);
const timestamp = z.iso.datetime({ offset: true });
const ratings = z.record(text, z.number());
const details = z.strictObject({
  terrain: text.optional(), teacher: text.optional(), startLeiter: text.optional(),
  startPlace: text.optional(), startTeacher: text.optional(), landPlace: text.optional(),
  landTeacher: text.optional(), altitudeDifferenceMeters: z.number().optional(),
});
const metadata = {
  syncId: id, updatedAt: timestamp.optional(), updatedByDeviceId: id.optional(),
};
const studentFields = {
  ...metadata, name: text, glider: text, color: text,
  totalFlights: z.number(), totalAltitudeMeters: z.number(),
  flightSchool: text, lastRatings: ratings.optional(), photoDataUrl: text.optional(),
};
const flightFields = {
  ...metadata, studentSyncId: id, maneuvers: z.array(text),
  ratings: ratings.optional(), remarks: z.array(text).optional(), details: details.optional(),
  startTime: timestamp, landingMarkedAt: timestamp.optional(), landingPendingUntil: timestamp.optional(),
  landingFinalizedAt: timestamp.optional(), endTime: timestamp.optional(),
};
const courseFields = {
  ...metadata, name: text, courseType: z.enum(['Grundkurs', 'Windenkurs', 'Höhenkurs']),
  startDate: text, endDate: text, flightSchool: text, flightDefaults: details.optional(),
};

const snapshotSchema = z.strictObject({
  snapshotVersion: z.literal(1), exportedAt: timestamp, roomId: id.optional(),
  course: z.strictObject({ ...courseFields, students: z.array(z.strictObject(studentFields)) }),
  flights: z.array(z.strictObject(flightFields)),
});
const coursePayload = z.strictObject(courseFields).partial();
const studentPayload = z.strictObject({ ...studentFields, photoDataUrl: text.nullable().optional() }).partial();
const flightPayload = z.strictObject({
  ...flightFields, studentId: z.number().int().positive().optional(),
  ratings: ratings.nullable().optional(), remarks: z.array(text).nullable().optional(),
  details: details.nullable().optional(), landingMarkedAt: timestamp.nullable().optional(),
  landingPendingUntil: timestamp.nullable().optional(), landingFinalizedAt: timestamp.nullable().optional(),
  endTime: timestamp.nullable().optional(),
}).partial();
const deletionFields = {
  syncId: id, updatedAt: timestamp.optional(), updatedByDeviceId: id.optional(),
  deletedAt: timestamp.optional(),
};
const envelopeFields = {
  version: z.literal(1), schemaVersion: z.literal(1), roomId: id, courseSyncId: id, deviceId: id,
  opId: id, opTs: timestamp,
  notification: z.strictObject({ title: text, body: text }).optional(),
};
const deltaSchema = z.discriminatedUnion('operation', [
  z.strictObject({ ...envelopeFields, operation: z.literal('course_upsert'), payload: coursePayload }),
  z.strictObject({ ...envelopeFields, operation: z.literal('student_upsert'), payload: studentPayload }),
  z.strictObject({ ...envelopeFields, operation: z.literal('student_delete'), payload: z.strictObject(deletionFields) }),
  z.strictObject({ ...envelopeFields, operation: z.literal('flight_upsert'), payload: flightPayload }),
  z.strictObject({ ...envelopeFields, operation: z.literal('flight_delete'), payload: z.strictObject({
    ...deletionFields, studentSyncId: id.optional(), studentId: z.number().int().positive().optional(),
  }) }),
]);

export const isCourseSyncSnapshot = (value: unknown): value is CourseSyncSnapshot => snapshotSchema.safeParse(value).success;
export const isRelaySyncEnvelope = (value: unknown): value is RelaySyncEnvelope => deltaSchema.safeParse(value).success;
