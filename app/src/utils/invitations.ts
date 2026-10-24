import type { ShareSession } from '../models/types';
import {
  assertMessageSize, decryptBox, encryptBox, INVITE_TTL_MS,
  isRecord, isSecret, randomSecret,
} from './e2eCrypto';
import { parseJoinInvite } from './parseJoinInvite';
import { getRoomKey, type RoomKey } from './roomKeys';

const inviteRequest = async (relayBaseUrl: string, path: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`${relayBaseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const code = isRecord(payload) ? payload.error : undefined;
    throw new Error(code === 'invite_expired' ? 'Einladung ist abgelaufen.'
      : code === 'invite_unavailable' ? 'Einladung ist verbraucht oder nicht mehr verfügbar.'
        : 'Einladung konnte nicht verarbeitet werden.');
  }
  return payload;
};

export const createInvitation = async (
  session: ShareSession, ticket: string, baseUrl: string,
): Promise<string> => {
  const roomKey = await getRoomKey(session.roomId);
  const inviteId = randomSecret();
  const key = randomSecret();
  const health = await fetch(`${session.relayBaseUrl.replace(/\/+$/, '')}/health`, { cache: 'no-store' });
  const clock: unknown = await health.json();
  if (!health.ok || !isRecord(clock) || typeof clock.serverTime !== 'number') throw new Error('Relay-Zeit nicht verfügbar.');
  const expiresAt = clock.serverTime + INVITE_TTL_MS;
  const box = await encryptBox(key, {
    version: 2, roomId: session.roomId, courseSyncId: session.courseSyncId,
    deviceId: session.deviceId, messageId: inviteId, epoch: roomKey.epoch, purpose: 'invite',
  }, { ...roomKey, sentCount: 0, joinSecret: session.joinSecret, expiresAt });
  assertMessageSize(box, 4096);
  await inviteRequest(session.relayBaseUrl, '/invites', {
    roomId: session.roomId, deviceId: session.deviceId, ticket, inviteId, box, expiresAt,
  });
  const url = new URL(baseUrl);
  url.searchParams.delete('joinInvite');
  url.hash = `/?${new URLSearchParams({ v: '2', invite: inviteId, key }).toString()}`;
  return url.toString();
};

export const redeemInvitation = async (
  raw: string, relayBaseUrl: string,
): Promise<{ roomKey: RoomKey; joinSecret: string }> => {
  const invite = parseJoinInvite(raw);
  if (!invite) throw new Error('Ungültige oder veraltete Einladung. Bitte einen neuen Link anfordern.');
  const response = await inviteRequest(relayBaseUrl, '/invites/redeem', { inviteId: invite.inviteId });
  if (!isRecord(response)) throw new Error('Ungültiges Einladungspaket.');
  const { box, value } = await decryptBox(invite.key, response.box, { purpose: 'invite', messageId: invite.inviteId });
  if (!isRecord(value) || !isSecret(value.secret) || !isSecret(value.joinSecret)
    || value.roomId !== box.roomId || value.courseSyncId !== box.courseSyncId
    || value.epoch !== box.epoch || typeof value.expiresAt !== 'number'
    || typeof response.serverTime !== 'number'
    || value.expiresAt <= response.serverTime) throw new Error('Einladungspaket ist ungültig oder abgelaufen.');
  return {
    roomKey: {
      roomId: box.roomId, courseSyncId: box.courseSyncId, epoch: box.epoch,
      secret: value.secret, sentCount: 0,
    },
    joinSecret: value.joinSecret,
  };
};
