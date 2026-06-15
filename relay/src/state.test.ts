import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type WebSocket from 'ws';
import { relayConfig } from './config.js';
import {
  ackQueuedMessagesForDevice,
  attachSessionToRoom,
  createSession,
  deleteSession,
  getOrCreateRoom,
  getRoom,
  listQueuedMessagesForDevice,
  pruneExpiredRoomState,
  queueMessageForDevice,
  resetStateForTests,
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
