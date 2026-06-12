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
