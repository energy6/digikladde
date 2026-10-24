import { expect, it } from 'vitest';
import { courseSnapshot } from '../test/fixtures';
import { buildCourseBackupCopyRecords, CourseBackupError, createCourseBackupEnvelope, parseCourseBackup, serializeCourseBackup } from './courseBackup';

it('roundtrips a backup and creates independently identified copies', () => {
  const snapshot = courseSnapshot();
  const parsed = parseCourseBackup(serializeCourseBackup(createCourseBackupEnvelope(snapshot, 'test')));
  expect(parsed.snapshot).toEqual(snapshot);
  const copy = buildCourseBackupCopyRecords(parsed.snapshot, 'copy-device', '2026-01-02T10:00:00Z');
  expect(copy.course.syncId).not.toBe(snapshot.course.syncId);
  expect(copy.students).toHaveLength(2);
  expect(copy.flights).toHaveLength(1);
  expect(copy.students.map((student) => student.syncId)).not.toContain('Anna');
  expect(copy.flights[0].syncId).not.toBe('flight');
  expect(copy.flights[0].ratings).toEqual(snapshot.flights[0].ratings);
});

it.each([
  ['{', 'invalid_json'],
  ['{"kind":"other"}', 'invalid_format'],
  [JSON.stringify({ kind: 'digikladde.course-backup', formatVersion: 99 }), 'unsupported_version'],
])('rejects invalid backup %s', (input, code) => {
  expect(() => parseCourseBackup(input)).toThrow(CourseBackupError);
  expect(() => parseCourseBackup(input)).toThrow(expect.objectContaining({ code }));
});

it('rejects flights referring to missing students', () => {
  const snapshot = courseSnapshot();
  snapshot.flights[0].studentSyncId = 'missing';
  expect(() => parseCourseBackup(JSON.stringify(createCourseBackupEnvelope(snapshot)))).toThrow(CourseBackupError);
});
