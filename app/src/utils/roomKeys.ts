import { db } from '../db/database';
import {
  encryptBox, MAX_KEY_MESSAGES, randomSecret, type EncryptedBox, type MessagePurpose,
} from './e2eCrypto';

export interface RoomKey {
  roomId: string;
  courseSyncId: string;
  epoch: string;
  secret: string;
  sentCount: number;
}

export interface ReceivedMessage {
  id: string;
  roomId: string;
}

export const replayId = (box: EncryptedBox): string => JSON.stringify([
  box.roomId, box.epoch, box.purpose, box.deviceId, box.messageId,
]);

export const getRoomKey = async (roomId: string): Promise<RoomKey> => {
  const key = await db.roomKeys.get(roomId);
  if (!key) throw new Error('Lokaler Raumschlüssel fehlt. Bitte erneut einladen lassen.');
  return key;
};

export const sealRoomMessage = async (
  roomId: string, deviceId: string, purpose: Exclude<MessagePurpose, 'invite'>,
  value: unknown, messageId = randomSecret(),
): Promise<EncryptedBox> => {
  const key = await db.transaction('rw', db.roomKeys, async () => {
    const current = await getRoomKey(roomId);
    if (current.sentCount >= MAX_KEY_MESSAGES) {
      throw new Error('Schlüssellimit erreicht. Diese Freigabe kann nicht fortgesetzt werden.');
    }
    await db.roomKeys.update(roomId, { sentCount: current.sentCount + 1 });
    return current;
  });
  return encryptBox(key.secret, {
    version: 2, roomId, courseSyncId: key.courseSyncId, epoch: key.epoch,
    deviceId, messageId, purpose,
  }, value);
};
