/* eslint-env node */

import assert from 'node:assert/strict';
import {
  buildCourseBackupCopyRecords,
  CourseBackupError,
  createCourseBackupEnvelope,
  parseCourseBackup,
  serializeCourseBackup,
} from '../src/utils/courseBackup';
import { buildDemoCourseSnapshot, defaultDemoCourseOptions } from '../src/utils/demoCourseData';

const assertBackupError = (callback: () => unknown, code: CourseBackupError['code']) => {
  assert.throws(callback, (error) => error instanceof CourseBackupError && error.code === code);
};

const snapshot = buildDemoCourseSnapshot({
  ...defaultDemoCourseOptions,
  seed: 42,
  days: 2,
  students: 3,
}, '2026-01-01T00:00:00.000Z');

const backup = createCourseBackupEnvelope(snapshot, 'smoke-test');
const serialized = serializeCourseBackup(backup);
const parsed = parseCourseBackup(serialized);

assert.equal(parsed.kind, 'digikladde.course-backup');
assert.equal(parsed.formatVersion, 1);
assert.equal(parsed.snapshot.course.students.length, 3);
assert.equal(parsed.snapshot.flights.length > 0, true);

const copy = buildCourseBackupCopyRecords(parsed.snapshot, 'smoke-device', '2026-01-02T00:00:00.000Z');
const originalStudentSyncIds = new Set(parsed.snapshot.course.students.map((student) => student.syncId));
const copyStudentSyncIds = new Set(copy.students.map((student) => student.syncId));

assert.notEqual(copy.course.syncId, parsed.snapshot.course.syncId);
assert.equal(copy.course.name, parsed.snapshot.course.name);
assert.equal(copy.students.length, parsed.snapshot.course.students.length);
assert.equal(copy.flights.length, parsed.snapshot.flights.length);

for (const syncId of copyStudentSyncIds) {
  assert.equal(originalStudentSyncIds.has(syncId ?? ''), false);
}

assertBackupError(() => parseCourseBackup('{'), 'invalid_json');
assertBackupError(() => parseCourseBackup(JSON.stringify({ kind: 'other', formatVersion: 1 })), 'invalid_format');
assertBackupError(
  () => parseCourseBackup(JSON.stringify({ kind: 'digikladde.course-backup', formatVersion: 99, exportedAt: '2026-01-01T00:00:00.000Z' })),
  'unsupported_version',
);

const invalidSnapshot = structuredClone(backup);
invalidSnapshot.snapshot.flights[0].studentSyncId = 'missing_student';
assertBackupError(() => parseCourseBackup(JSON.stringify(invalidSnapshot)), 'invalid_snapshot');

console.log('Course backup smoke passed');
