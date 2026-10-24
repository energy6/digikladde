import { expect, it } from 'vitest';
import { db } from '../db/database';
import { courseSnapshot, delta, initialTime } from '../test/fixtures';
import { encryptBox, randomSecret } from './e2eCrypto';
import { applyProtectedSync } from './protectedSync';
import { sealRoomMessage } from './roomKeys';

const setup = async () => {
  await db.roomKeys.add({ roomId: 'room', courseSyncId: 'course', epoch: 'epoch', secret: randomSecret(), sentCount: 0 });
  const snapshot = { ...courseSnapshot(), roomId: 'room' };
  const box = await sealRoomMessage('room', 'remote-device', 'snapshot', snapshot);
  return { snapshot, box };
};

it('imports snapshots and deltas atomically, and suppresses replays after reopening the DB', async () => {
  const { box } = await setup();
  await applyProtectedSync('room', box, 'local', 'remote-device');
  const event = delta('course_upsert', { syncId: 'course', name: 'Encrypted change', updatedAt: '2026-01-02T10:00:00Z' });
  const update = await sealRoomMessage('room', 'remote-device', 'delta', event, event.opId);
  await applyProtectedSync('room', update, 'local', 'remote-device');
  expect((await db.courses.toArray())[0].name).toBe('Encrypted change');
  db.close();
  await db.open();
  await applyProtectedSync('room', box, 'local', 'remote-device');
  await applyProtectedSync('room', update, 'local', 'remote-device');
  expect(await db.courses.count()).toBe(1);
  expect(await db.receivedMessages.count()).toBe(2);
  expect(await db.syncEvents.count()).toBe(1);
  expect((await db.courses.toArray())[0].name).toBe('Encrypted change');
});

it('rejects forged, wrong-context, plaintext and malformed decrypted content without DB changes', async () => {
  const { snapshot, box } = await setup();
  const key = await db.roomKeys.get('room');
  expect(key).toBeDefined();
  if (!key) throw new Error('Test key missing');
  const malformed = await encryptBox(key.secret, { ...box, messageId: 'bad-content' }, { ...snapshot, course: {} });
  const wrongCourse = await sealRoomMessage('room', 'remote-device', 'snapshot', {
    ...snapshot, course: { ...snapshot.course, syncId: 'different' },
  });
  const wrongPurpose = await sealRoomMessage('room', 'remote-device', 'push', snapshot);
  const wrongDelta = delta('course_upsert', { syncId: 'different', name: 'Wrong course' });
  const wrongBinding = await sealRoomMessage('room', 'remote-device', 'delta', wrongDelta, wrongDelta.opId);
  for (const invalid of [
    snapshot, { ...box, iv: 'AAAAAAAAAAAAAAAA' }, { ...box, epoch: 'other' }, malformed, wrongCourse,
    wrongPurpose, wrongBinding,
  ]) {
    await expect(applyProtectedSync('room', invalid, 'local', 'remote-device')).rejects.toThrow();
    expect(await db.courses.count()).toBe(0);
    expect(await db.syncEvents.count()).toBe(0);
    expect(await db.receivedMessages.count()).toBe(0);
  }
  await expect(applyProtectedSync('room', box, 'local', 'forged-device')).rejects.toThrow();
});

it('rolls back ingested delta and replay state when application fails', async () => {
  await setup();
  const event = delta('student_upsert', { syncId: 'Anna', name: 'Anna', updatedAt: initialTime });
  const box = await sealRoomMessage('room', 'remote-device', 'delta', event, event.opId);
  await expect(applyProtectedSync('room', box, 'local', 'remote-device')).rejects.toThrow();
  expect(await db.syncEvents.count()).toBe(0);
  expect(await db.receivedMessages.count()).toBe(0);
  expect(await db.students.count()).toBe(0);
});
