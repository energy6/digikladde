import { expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { randomSecret } from './e2eCrypto';
import { resolveEncryptedPush } from './encryptedPush';
import { sealRoomMessage } from './roomKeys';

it('decrypts locally persisted push details without affecting sync replay state', async () => {
  await db.roomKeys.add({ roomId: 'room', courseSyncId: 'course', epoch: 'epoch', secret: randomSecret(), sentCount: 0 });
  const detail = { title: 'DigiKladde', body: 'Synthetic Anna gestartet' };
  const box = await sealRoomMessage('room', 'sender', 'push', detail, 'same-id');
  const sync = await sealRoomMessage('room', 'sender', 'delta', {}, 'same-id');
  db.close();
  await db.open();
  expect(await resolveEncryptedPush({ version: 2, roomId: 'room', box })).toEqual(detail);
  expect(await resolveEncryptedPush({ version: 2, roomId: 'room', box })).toBeNull();
  expect(JSON.stringify(sync)).not.toContain(detail.body);
  const { replayId } = await import('./roomKeys');
  expect(await db.receivedMessages.get(replayId(sync))).toBeUndefined();
});

it('shows only generic content for missing keys, tampering and legacy plaintext', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await db.roomKeys.add({ roomId: 'room', courseSyncId: 'course', epoch: 'epoch', secret: randomSecret(), sentCount: 0 });
  const box = await sealRoomMessage('room', 'sender', 'push', { title: 'Secret title', body: 'Secret body' });
  for (const payload of [
    { title: 'Secret title', body: 'Secret body' },
    { version: 2, roomId: 'missing', box },
    { version: 2, roomId: 'room', box: { ...box, iv: 'AAAAAAAAAAAAAAAA' } },
    { version: 2, roomId: 'room', box: { ...box, purpose: 'delta' } },
    { version: 2, roomId: 'room' },
  ]) {
    expect(await resolveEncryptedPush(payload)).toEqual({ title: 'DigiKladde', body: 'Neue Kursdaten verfügbar.' });
  }
  expect(await db.receivedMessages.count()).toBe(0);
  expect(console.warn).toHaveBeenCalled();
});
