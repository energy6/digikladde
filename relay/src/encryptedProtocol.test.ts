import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { consumeInvitation, INVITE_TTL_MS, pruneInvitations, storeInvitation } from './encryptedProtocol.js';

const fixture = (now: number) => {
  const id = randomBytes(32).toString('base64url');
  return {
    id, entry: {
      roomId: id, expiresAt: now + INVITE_TTL_MS,
      box: {
        version: 2, roomId: id, courseSyncId: 'course', deviceId: 'device', messageId: id,
        epoch: 'epoch', purpose: 'invite', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(24),
      },
    },
  };
};

void test('enforces exactly ten minutes with an exclusive expiration boundary', () => {
  const now = 1000;
  const before = fixture(now);
  assert.ok(storeInvitation(before.id, before.entry, now));
  assert.deepEqual(consumeInvitation(before.id, now + INVITE_TTL_MS - 1), { box: before.entry.box });
  assert.deepEqual(consumeInvitation(before.id, now), { error: 'invite_unavailable' });
  const expired = fixture(now);
  assert.ok(storeInvitation(expired.id, expired.entry, now));
  assert.deepEqual(consumeInvitation(expired.id, now + INVITE_TTL_MS), { error: 'invite_expired' });
  const excessive = fixture(now);
  assert.equal(storeInvitation(excessive.id, { ...excessive.entry, expiresAt: now + INVITE_TTL_MS + 1 }, now), false);
});

void test('cleans up expired invitations and rejects duplicate IDs and unbounded content', () => {
  const now = 1000;
  const { id, entry } = fixture(now);
  assert.ok(storeInvitation(id, entry, now));
  assert.equal(storeInvitation(id, entry, now), false);
  pruneInvitations(now + INVITE_TTL_MS);
  assert.deepEqual(consumeInvitation(id, now), { error: 'invite_unavailable' });
  const other = fixture(now);
  assert.equal(storeInvitation(other.id, { ...other.entry, box: { ...other.entry.box, ciphertext: 'A'.repeat(5000) } }, now), false);
  assert.equal(storeInvitation(other.id, { ...other.entry, box: { ...other.entry.box, key: 'secret' } }, now), false);
});
