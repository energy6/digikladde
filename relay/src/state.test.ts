import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type WebSocket from 'ws';
import { relayConfig } from './config.js';
import {
  ackQueuedMessagesForDevice,
  attachSessionToRoom,
  bufferMessage,
  canOpenConnectionForIp,
  createSession,
  deleteSession,
  getOrCreateRoom,
  getRoom,
  getRoomSessions,
  getRoomSessionsByDevice,
  listQueuedMessagesForDevice,
  markEventAndCheckRate,
  pruneExpiredRoomState,
  queueMessageForDevice,
  resetStateForTests,
  registerJoinAttemptAndCheckLimit,
  snapshotStats,
} from './state.js';

const createFakeWebSocket = () => ({
  readyState: 1,
  OPEN: 1,
  send: () => {},
  close: () => {},
}) as unknown as WebSocket;

beforeEach(() => {
  resetStateForTests();
});

void test('queues and acknowledges per-device relay messages', () => {
  const room = getOrCreateRoom('room_a', 'secret');

  queueMessageForDevice(room, 'device_b', {
    ts: 1000,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: {
      kind: 'delta',
      envelope: { opId: 'op_1' },
    },
  });

  assert.equal(listQueuedMessagesForDevice(room, 'device_b', 0).length, 1);
  assert.equal(listQueuedMessagesForDevice(room, 'device_b', 1).length, 0);

  ackQueuedMessagesForDevice(room, 'device_b', 1);
  assert.equal(listQueuedMessagesForDevice(room, 'device_b', 0).length, 0);
});

void test('deduplicates queued relay messages per target device and op id', () => {
  const room = getOrCreateRoom('room_a', 'secret');

  const first = queueMessageForDevice(room, 'device_b', {
    ts: 1000,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: {
      kind: 'delta',
      envelope: { opId: 'op_1' },
    },
  }, 'op_1');

  const duplicate = queueMessageForDevice(room, 'device_b', {
    ts: 1001,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: {
      kind: 'delta',
      envelope: { opId: 'op_1' },
    },
  }, 'op_1');

  assert.ok(first);
  assert.equal(duplicate, null);
  assert.equal(listQueuedMessagesForDevice(room, 'device_b', 0).length, 1);
  assert.equal(snapshotStats().deliveredDeltaOpIdCount, 1);
});

void test('deduplicates relay messages independently per target device', () => {
  const room = getOrCreateRoom('room_a', 'secret');

  const first = queueMessageForDevice(room, 'device_b', {
    ts: 1000,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  }, 'op_1');
  const second = queueMessageForDevice(room, 'device_c', {
    ts: 1001,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  }, 'op_1');

  assert.ok(first);
  assert.ok(second);
  assert.equal(listQueuedMessagesForDevice(room, 'device_b', 0).length, 1);
  assert.equal(listQueuedMessagesForDevice(room, 'device_c', 0).length, 1);
  assert.equal(snapshotStats().deliveredDeltaOpIdCount, 2);
});

void test('expires stale queued messages after retention window', () => {
  const room = getOrCreateRoom('room_a', 'secret');
  const now = 10_000 + relayConfig.queueRetentionMs;

  queueMessageForDevice(room, 'device_b', {
    ts: now - relayConfig.queueRetentionMs - 1,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  });
  queueMessageForDevice(room, 'device_b', {
    ts: now - relayConfig.queueRetentionMs + 1,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  });

  pruneExpiredRoomState(now);

  const retained = listQueuedMessagesForDevice(room, 'device_b', 0);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].seq, 2);
});

void test('expires stale delivered op ids after retention window', () => {
  const room = getOrCreateRoom('room_a', 'secret');
  const now = 10_000 + relayConfig.queueRetentionMs;

  queueMessageForDevice(room, 'device_b', {
    ts: now - relayConfig.queueRetentionMs - 1,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  }, 'op_stale');
  queueMessageForDevice(room, 'device_b', {
    ts: now - relayConfig.queueRetentionMs + 1,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  }, 'op_fresh');

  pruneExpiredRoomState(now);

  assert.equal(snapshotStats().deliveredDeltaOpIdCount, 1);

  const retried = queueMessageForDevice(room, 'device_b', {
    ts: now + 1,
    fromDeviceId: 'device_a',
    type: 'sync_response',
    payload: { kind: 'delta' },
  }, 'op_stale');

  assert.ok(retried);
  assert.equal(snapshotStats().deliveredDeltaOpIdCount, 2);
});

void test('keeps empty rooms until retention expires', () => {
  const room = getOrCreateRoom('room_a', 'secret');
  const session = createSession(createFakeWebSocket(), '127.0.0.1');
  attachSessionToRoom(session, room, 'device_a', 'ticket', Date.now() + 60_000);

  deleteSession(session);
  assert.ok(getRoom('room_a'));

  pruneExpiredRoomState(Date.now() + relayConfig.queueRetentionMs + 1);

  assert.equal(getRoom('room_a'), undefined);
  assert.equal(snapshotStats().roomCount, 0);
});

void test('tracks sessions by room/device and frees connection slots on disconnect', () => {
  const room = getOrCreateRoom('a', 'secret');
  const other = getOrCreateRoom('b', 'different');
  const sessions = Array.from({ length: relayConfig.maxConnectionsPerIp }, () => createSession(createFakeWebSocket(), 'local'));
  assert.equal(canOpenConnectionForIp('local'), false);
  attachSessionToRoom(sessions[0], room, 'teacher-a', 'ticket', 60_000);
  attachSessionToRoom(sessions[1], other, 'teacher-b', 'ticket', 60_000);
  assert.deepEqual(getRoomSessions(room), [sessions[0]]);
  assert.deepEqual(getRoomSessionsByDevice(room, 'teacher-b'), []);
  deleteSession(sessions[0]);
  assert.equal(canOpenConnectionForIp('local'), true);
  assert.deepEqual(getRoomSessions(room), []);
  assert.deepEqual(getRoomSessionsByDevice(room, 'teacher-a'), []);
  assert.deepEqual(getRoomSessions(other), [sessions[1]]);
});

void test('enforces event/join limits at exact minute boundaries without waiting', () => {
  const room = getOrCreateRoom('a', 'secret');
  for (let i = 0; i < relayConfig.maxJoinPerMinutePerRoom; i++) {
    assert.equal(registerJoinAttemptAndCheckLimit(room, 100_000), true);
  }
  assert.equal(registerJoinAttemptAndCheckLimit(room, 160_000), false);
  assert.equal(registerJoinAttemptAndCheckLimit(room, 160_001), true);
  for (let i = 0; i < relayConfig.maxEventsPerMinutePerIp; i++) {
    assert.equal(markEventAndCheckRate('local', 100_000), true);
  }
  assert.equal(markEventAndCheckRate('local', 160_000), false);
  assert.equal(markEventAndCheckRate('local', 160_001), true);
  assert.equal(markEventAndCheckRate('other', 100_000), true);
});

void test('bounds replay buffers and acknowledges only the requested device and sequences', () => {
  const room = getOrCreateRoom('a', 'secret');
  for (let i = 0; i <= relayConfig.messageBufferLimitPerRoom; i++) {
    bufferMessage(room, { ts: i, type: 'sync_response' });
  }
  assert.equal(room.messageBuffer.length, relayConfig.messageBufferLimitPerRoom);
  assert.equal(room.messageBuffer[0].ts, 1);
  for (const device of ['a', 'b']) {
    for (let i = 0; i < 3; i++) queueMessageForDevice(room, device, { ts: i, type: 'sync_response', fromDeviceId: 'sender', payload: {} });
  }
  ackQueuedMessagesForDevice(room, 'a', 2);
  assert.deepEqual(listQueuedMessagesForDevice(room, 'a', 0).map((message) => message.seq), [3]);
  assert.deepEqual(listQueuedMessagesForDevice(room, 'b', 1).map((message) => message.seq), [2, 3]);
  queueMessageForDevice(room, 'a', { ts: 4, type: 'sync_response', fromDeviceId: 'sender', payload: {} });
  assert.deepEqual(listQueuedMessagesForDevice(room, 'a', 0).map((message) => message.seq), [3, 4]);
});
