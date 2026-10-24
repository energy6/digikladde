import { expect, it, vi } from 'vitest';
import {
  assertMessageSize, decryptBox, encryptBox, fromBase64Url, isEncryptedBox,
  MAX_KEY_MESSAGES, MAX_PUSH_BYTES, MAX_SYNC_BYTES, randomSecret, requireCrypto, type BoxContext,
} from './e2eCrypto';
import { db } from '../db/database';
import { sealRoomMessage } from './roomKeys';
import { courseSnapshot } from '../test/fixtures';

const context: BoxContext = {
  version: 2, roomId: 'room', courseSyncId: 'course', epoch: 'epoch',
  deviceId: 'device', messageId: 'message', purpose: 'delta',
};

it('encrypts synthetic sensitive data and authenticates every header field', async () => {
  const secret = randomSecret();
  const box = await encryptBox(secret, context, { studentName: 'SensitiveTestMarker', photo: 'photo-data' });
  expect(JSON.stringify(box)).not.toContain('SensitiveTestMarker');
  expect(JSON.stringify(box)).not.toContain(secret);
  expect((await decryptBox(secret, box, context)).value).toEqual({ studentName: 'SensitiveTestMarker', photo: 'photo-data' });
  for (const field of ['roomId', 'courseSyncId', 'epoch', 'deviceId', 'messageId'] as const) {
    await expect(decryptBox(secret, { ...box, [field]: 'different' }, {})).rejects.toThrow();
  }
  await expect(decryptBox(secret, { ...box, purpose: 'push' }, {})).rejects.toThrow();
  await expect(decryptBox(randomSecret(), box, {})).rejects.toThrow();
  await expect(decryptBox(secret, { ...box, ciphertext: `${box.ciphertext[0] === 'A' ? 'B' : 'A'}${box.ciphertext.slice(1)}` }, {})).rejects.toThrow();
  await expect(decryptBox(secret, { ...box, iv: 'AAAAAAAAAAAAAAAA' }, {})).rejects.toThrow();
  await expect(decryptBox(secret, box, { roomId: 'other' })).rejects.toThrow();
});

it('generates fresh 96-bit nonces and separates push and sync keys', async () => {
  const secret = randomSecret();
  const first = await encryptBox(secret, context, 'same');
  const second = await encryptBox(secret, context, 'same');
  expect(fromBase64Url(first.iv)).toHaveLength(12);
  expect(first.iv).not.toBe(second.iv);
  const push = await encryptBox(secret, { ...context, purpose: 'push' }, 'same');
  await expect(decryptBox(secret, { ...push, purpose: 'delta' }, {})).rejects.toThrow();
  expect(isEncryptedBox({ ...first, payload: 'plaintext' })).toBe(false);
  expect(() => assertMessageSize({ text: 'ü'.repeat(10) }, 10)).toThrow();
});

it('fails closed without Web Crypto', () => {
  vi.stubGlobal('crypto', undefined);
  try {
    expect(() => requireCrypto()).toThrow('Web Crypto');
    expect(() => randomSecret()).toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('reserves key usage atomically and refuses encryption at the key limit', async () => {
  await db.roomKeys.add({ roomId: 'room', courseSyncId: 'course', epoch: 'epoch', secret: randomSecret(), sentCount: MAX_KEY_MESSAGES - 1 });
  const results = await Promise.allSettled([
    sealRoomMessage('room', 'device', 'delta', {}),
    sealRoomMessage('room', 'device', 'delta', {}),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await db.roomKeys.get('room'))?.sentCount).toBe(MAX_KEY_MESSAGES);
});

it('enforces exact byte limits including Unicode and retains near-128-KiB photo snapshots', async () => {
  for (const limit of [MAX_PUSH_BYTES, MAX_SYNC_BYTES]) {
    const overhead = JSON.stringify({ text: '' }).length;
    expect(() => assertMessageSize({ text: 'A'.repeat(limit - overhead) }, limit)).not.toThrow();
    expect(() => assertMessageSize({ text: 'A'.repeat(limit - overhead + 1) }, limit)).toThrow();
    expect(() => assertMessageSize({ text: 'ü'.repeat(Math.floor((limit - overhead) / 2) + 1) }, limit)).toThrow();
  }
  const snapshot = courseSnapshot();
  snapshot.roomId = 'room';
  snapshot.course.students[0].photoDataUrl = `data:image/jpeg;base64,${'A'.repeat(125000)}`;
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  expect(plaintextBytes).toBeGreaterThan(120 * 1024);
  expect(plaintextBytes).toBeLessThan(128 * 1024);
  const secret = randomSecret();
  const box = await encryptBox(secret, { ...context, purpose: 'snapshot' }, snapshot);
  expect(() => assertMessageSize({ version: 2, type: 'sync_response', payload: { box } }, MAX_SYNC_BYTES)).not.toThrow();
  expect((await decryptBox(secret, box, { purpose: 'snapshot' })).value).toEqual(snapshot);
});
