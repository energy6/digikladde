import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientEnvelopeSchema } from './protocol.js';

const joined = { version: 2, roomId: 'room', deviceId: 'device', ticket: 'ticket', seq: 0 };
const subscription = {
  endpoint: 'https://push.example.test/subscription',
  expirationTime: null,
  keys: { p256dh: 'public-key', auth: 'auth-key' },
};
const box = {
  version: 2, roomId: 'room', courseSyncId: 'course', deviceId: 'device', messageId: 'message',
  epoch: 'epoch', purpose: 'snapshot_request', iv: 'A'.repeat(16), ciphertext: 'A'.repeat(24),
};

const validMessages = [
  {
    version: 2,
    type: 'join_request',
    payload: { roomId: ' room ', deviceId: ' device ', joinSecret: ' secret ' },
  },
  { ...joined, type: 'ticket_refresh' },
  { ...joined, type: 'catchup_request' },
  { ...joined, type: 'catchup_request', payload: {} },
  { ...joined, type: 'catchup_request', payload: { afterSeq: 0 } },
  { ...joined, type: 'catchup_ack', payload: { throughSeq: Number.MAX_SAFE_INTEGER } },
  { ...joined, type: 'push_subscribe', payload: { subscription } },
  { ...joined, type: 'push_unsubscribe', payload: {} },
  ...['sync_request', 'sync_response'].map((type) => ({
    ...joined,
    type,
    targetDeviceId: 'peer',
    payload: { box },
  })),
];

for (const [index, message] of validMessages.entries()) {
  void test(`accepts client message ${message.type} (${index})`, () => {
    const parsed = clientEnvelopeSchema.parse(message);
    if (parsed.type === 'join_request') {
      assert.deepEqual(parsed.payload, { roomId: 'room', deviceId: 'device', joinSecret: 'secret' });
    } else {
      assert.deepEqual(parsed, message);
    }
  });
}

void test('rejects invalid envelopes, server-only events and unknown fields', () => {
  const base = { ...joined, type: 'sync_request', payload: { box } };
  const invalid: unknown[] = [
    null, [], 1, true, 'message', {},
    ...['join_ok', 'join_denied', 'catchup_response', 'error', 'unknown'].map((type) => ({ ...base, type })),
    { ...base, version: 1 },
    { ...base, extra: 'not-in-v1' },
  ];
  for (const field of ['roomId', 'deviceId', 'ticket', 'targetDeviceId']) {
    for (const value of [null, 42, true, {}, [], '']) invalid.push({ ...base, [field]: value });
  }
  for (const field of ['roomId', 'deviceId', 'ticket']) {
    invalid.push({ ...base, [field]: undefined });
  }
  for (const seq of [-1, 0.5, '1', null, {}, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    invalid.push({ ...base, seq });
  }
  for (const value of invalid) {
    assert.equal(clientEnvelopeSchema.safeParse(value).success, false, JSON.stringify(value));
  }
});

void test('rejects plaintext V1 payloads and opaque boxes with unexpected properties', () => {
  for (const payload of [
    { kind: 'delta', envelope: { studentName: 'sensitive' } },
    { box, notification: { body: 'sensitive' } },
    { box: { ...box, studentName: 'sensitive' } },
    { box: { ...box, version: 1 } },
    { box: { ...box, iv: '' } },
  ]) {
    assert.equal(clientEnvelopeSchema.safeParse({ ...joined, type: 'sync_response', payload }).success, false);
  }
});

void test('rejects malformed payloads for every client event', () => {
  for (const message of validMessages) {
    for (const payload of [null, [], 42, true, 'payload']) {
      assert.equal(clientEnvelopeSchema.safeParse({ ...message, payload }).success, false, message.type);
    }
  }
  for (const type of ['join_request', 'catchup_ack', 'push_subscribe']) {
    assert.equal(clientEnvelopeSchema.safeParse({ ...joined, type }).success, false, type);
  }
  for (const type of ['ticket_refresh', 'push_unsubscribe']) {
    assert.equal(clientEnvelopeSchema.safeParse({ ...joined, type, payload: { extra: true } }).success, false);
  }
});

void test('validates join fields without coercion and rejects unknown fields', () => {
  const payload = { roomId: 'room', deviceId: 'device', joinSecret: 'secret' };
  for (const field of Object.keys(payload)) {
    for (const value of [undefined, null, {}, [], true, 42, '', ' \t ']) {
      const result = clientEnvelopeSchema.safeParse({
        version: 2, type: 'join_request', payload: { ...payload, [field]: value },
      });
      assert.equal(result.success, false, `${field}: ${JSON.stringify(value)}`);
    }
  }
  assert.equal(clientEnvelopeSchema.safeParse({
    version: 2, type: 'join_request', payload: { ...payload, extra: true },
  }).success, false);
});

void test('requires nonnegative safe integer cursors without coercion or silent defaults', () => {
  for (const [type, field] of [['catchup_request', 'afterSeq'], ['catchup_ack', 'throughSeq']]) {
    for (const value of [-1, 0.5, '1', null, {}, { valueOf: 0, toString: 0 }, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(clientEnvelopeSchema.safeParse({
        ...joined, type, payload: { [field]: value },
      }).success, false, `${type}: ${JSON.stringify(value)}`);
    }
    assert.equal(clientEnvelopeSchema.safeParse({
      ...joined, type, payload: { [field]: 0 },
    }).success, true);
    assert.equal(clientEnvelopeSchema.safeParse({
      ...joined, type, payload: { [field]: 1, extra: true },
    }).success, false);
  }
});

void test('validates push subscription structure, HTTPS endpoint and expiration', () => {
  const invalidSubscriptions = [
    {},
    { ...subscription, endpoint: '' },
    { ...subscription, endpoint: 'not a URL' },
    { ...subscription, endpoint: 'http://push.example.test/subscription' },
    { ...subscription, keys: null },
    { ...subscription, keys: { p256dh: {}, auth: 'key' } },
    { ...subscription, keys: { p256dh: '', auth: 'key' } },
    { ...subscription, keys: { p256dh: 'key', auth: '' } },
    { ...subscription, keys: { ...subscription.keys, extra: true } },
    { ...subscription, expirationTime: '123' },
    { ...subscription, expirationTime: -1 },
    { ...subscription, extra: true },
  ];
  for (const value of invalidSubscriptions) {
    assert.equal(clientEnvelopeSchema.safeParse({
      ...joined, type: 'push_subscribe', payload: { subscription: value },
    }).success, false, JSON.stringify(value));
  }
  for (const expirationTime of [undefined, null, 0, 123]) {
    assert.equal(clientEnvelopeSchema.safeParse({
      ...joined, type: 'push_subscribe', payload: { subscription: { ...subscription, expirationTime } },
    }).success, true);
  }
});
