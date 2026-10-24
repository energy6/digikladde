import { db } from '../db/database';
import { decryptBox, isRecord, MAX_PUSH_BYTES } from './e2eCrypto';
import { replayId } from './roomKeys';

export interface NotificationText {
  title: string;
  body: string;
}

const generic: NotificationText = { title: 'DigiKladde', body: 'Neue Kursdaten verfügbar.' };

export const resolveEncryptedPush = async (payload: unknown): Promise<NotificationText | null> => {
  if (!isRecord(payload) || payload.version !== 2 || typeof payload.roomId !== 'string') {
    console.warn('Push: ungültiges oder veraltetes Format.');
    return generic;
  }
  if (payload.box === undefined) return generic;
  if (new TextEncoder().encode(JSON.stringify(payload.box)).byteLength > MAX_PUSH_BYTES) {
    console.warn('Push: ungültiges verschlüsseltes Format.');
    return generic;
  }
  const key = await db.roomKeys.get(payload.roomId);
  if (!key) return generic;
  let decoded: Awaited<ReturnType<typeof decryptBox>>;
  try {
    decoded = await decryptBox(key.secret, payload.box, {
      version: 2, roomId: key.roomId, courseSyncId: key.courseSyncId, epoch: key.epoch, purpose: 'push',
    });
  } catch {
    console.warn('Push: E2E-Prüfung fehlgeschlagen.');
    return generic;
  }
  const { box, value: plaintext } = decoded;
  if (!isRecord(plaintext) || typeof plaintext.title !== 'string' || typeof plaintext.body !== 'string') {
    console.warn('Push: entschlüsselter Inhalt ungültig.');
    return generic;
  }
  const notification = { title: plaintext.title, body: plaintext.body };
  return db.transaction('rw', db.roomKeys, db.receivedMessages, async () => {
    if (!await db.roomKeys.get(key.roomId)) return generic;
    const id = replayId(box);
    if (await db.receivedMessages.get(id)) return null;
    await db.receivedMessages.add({ id, roomId: key.roomId });
    return notification;
  });
};
