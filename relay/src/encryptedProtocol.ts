import { encryptedBoxSchema } from './protocol.js';

export const INVITE_TTL_MS = 10 * 60 * 1000;
export const isBox = (value: unknown): value is Record<string, unknown> => {
  return encryptedBoxSchema.safeParse(value).success;
};

interface Invitation {
  roomId: string;
  expiresAt: number;
  box: Record<string, unknown>;
}

const invitations = new Map<string, Invitation>();

export const pruneInvitations = (now = Date.now()): void => {
  for (const [id, invitation] of invitations) {
    if (invitation.expiresAt <= now) invitations.delete(id);
  }
};

export const storeInvitation = (
  id: string, invitation: Invitation, now = Date.now(),
): boolean => {
  pruneInvitations(now);
  if (!/^[A-Za-z0-9_-]{43}$/.test(id) || invitations.has(id)
    || invitation.expiresAt <= now || invitation.expiresAt > now + INVITE_TTL_MS
    || !isBox(invitation.box) || invitation.box.purpose !== 'invite'
    || invitation.box.messageId !== id || invitation.box.roomId !== invitation.roomId
    || Buffer.byteLength(JSON.stringify(invitation.box)) > 4096
    || invitations.size >= 10000
    || Array.from(invitations.values()).filter((entry) => entry.roomId === invitation.roomId).length >= 40) return false;
  invitations.set(id, invitation);
  return true;
};

export const consumeInvitation = (
  id: string, now = Date.now(),
): { box: Record<string, unknown> } | { error: 'invite_expired' | 'invite_unavailable' } => {
  const invitation = invitations.get(id);
  if (!invitation) return { error: 'invite_unavailable' };
  // There is no await between checking and deleting: competing requests cannot both redeem.
  invitations.delete(id);
  if (invitation.expiresAt <= now) return { error: 'invite_expired' };
  return { box: invitation.box };
};
