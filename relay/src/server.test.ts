import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import type { RelayEnvelope } from './types.js';

const timeout = () => AbortSignal.timeout(5000);

const freePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: timeout() });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
};

const receive = async (ws: WebSocket): Promise<RelayEnvelope> => {
  const [raw] = await once(ws, 'message', { signal: timeout() });
  return JSON.parse(String(raw)) as RelayEnvelope;
};

const exchange = (ws: WebSocket, envelope: Record<string, unknown>) => {
  const response = receive(ws);
  ws.send(JSON.stringify(envelope));
  return response;
};

void test('relay validates client messages and isolates message-processing failures', { timeout: 60_000 }, async (t) => {
  const port = await freePort();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RELAY_')));
  // Inject an internal failure independently of malformed input, which validation now rejects.
  const faultInjection = `
    const stringify = JSON.stringify;
    JSON.stringify = function(value, replacer, space) {
      if (value?.type === 'ticket_refresh' && value?.deviceId === 'fault-injection-device') {
        throw new TypeError('Injected serialization failure');
      }
      return stringify(value, replacer, space);
    };
  `;
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--import', `data:text/javascript,${encodeURIComponent(faultInjection)}`,
    'src/server.ts',
  ], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...env,
      RELAY_HOST: '127.0.0.1',
      RELAY_PORT: String(port),
      RELAY_MAX_JOIN_PER_MINUTE_PER_ROOM: '3',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  const clients = new Set<WebSocket>();
  t.after(async () => {
    clients.forEach((ws) => ws.terminate());
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const forceStop = setTimeout(() => child.kill('SIGKILL'), 5000);
    forceStop.unref();
    try {
      await exited;
    } finally {
      clearTimeout(forceStop);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Relay did not start:\n${output}`)), 5000);
    const onData = () => {
      if (output.includes('"message":"relay server started"')) {
        clearTimeout(deadline);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(deadline);
      reject(new Error(`Relay exited during startup:\n${output}`));
    });
  });
  const pid = child.pid;
  assert.ok(pid);

  const health = async () => {
    assert.equal(child.exitCode, null, output);
    assert.equal(child.signalCode, null, output);
    assert.equal(child.pid, pid);
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: timeout() });
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; stats: { roomCount: number; sessionCount: number } };
    assert.equal(body.status, 'ok');
    return body.stats;
  };
  await health();

  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`);
    clients.add(ws);
    await once(ws, 'open', { signal: timeout() });
    return ws;
  };
  const close = async (ws: WebSocket) => {
    const closed = once(ws, 'close', { signal: timeout() });
    ws.close();
    await closed;
    clients.delete(ws);
  };
  const join = (ws: WebSocket, roomId: string, deviceId = 'test-device', joinSecret = 'test-secret') => (
    exchange(ws, { version: 1, type: 'join_request', payload: { roomId, deviceId, joinSecret } })
  );

  const validPayload = { roomId: 'test-room', deviceId: 'test-device', joinSecret: 'test-secret' };
  const invalidValues = [42, true, {}, [], null, undefined, '', ' \t '];
  const cases: { name: string; payload: unknown }[] = [];
  for (const field of ['roomId', 'deviceId', 'joinSecret']) {
    for (const [index, value] of invalidValues.entries()) {
      cases.push({ name: `${field} invalid value ${index}`, payload: { ...validPayload, [field]: value } });
    }
  }
  for (const [index, payload] of [undefined, null, 42, true, 'invalid', []].entries()) {
    cases.push({ name: `invalid payload ${index}`, payload });
  }

  for (const [index, entry] of cases.entries()) {
    await t.test(entry.name, async () => {
      const ws = await connect();
      const before = await health();
      const response = await exchange(ws, { version: 1, type: 'join_request', payload: entry.payload });
      assert.equal(response.type, 'error');
      assert.equal(response.payload?.code, 'invalid_event');
      assert.deepEqual(await health(), before);
      const retry = await join(ws, `retry-${index}`);
      assert.equal(retry.type, 'join_ok');
      assert.equal(retry.deviceId, 'test-device');
      assert.equal(typeof retry.ticket, 'string');
      await close(ws);
    });
  }

  await t.test('validates before consuming room join attempts and preserves joined sessions', async () => {
    const a = await connect();
    const b = await connect();
    const joinedA = await join(a, ' shared-room ', ' device-a ', ' shared-secret ');
    assert.equal(joinedA.type, 'join_ok');
    assert.equal(joinedA.roomId, 'shared-room');
    assert.equal(joinedA.deviceId, 'device-a');
    const before = await health();
    for (let index = 0; index < 3; index += 1) {
      const invalid = await exchange(a, {
        version: 1,
        type: 'join_request',
        payload: { roomId: 'shared-room', deviceId: {}, joinSecret: 'shared-secret' },
      });
      assert.equal(invalid.payload?.code, 'invalid_event');
    }
    assert.deepEqual(await health(), before);
    const joinedB = await join(b, 'shared-room', 'device-b', 'shared-secret');
    assert.equal(joinedB.type, 'join_ok');
    const forwarded = receive(b);
    a.send(JSON.stringify({
      version: 1,
      type: 'peer_key_request',
      roomId: joinedA.roomId,
      deviceId: joinedA.deviceId,
      ticket: joinedA.ticket,
      payload: { hello: 'world' },
    }));
    const message = await forwarded;
    assert.equal(message.type, 'peer_key_request');
    assert.equal(message.deviceId, 'device-a');
    assert.equal(message.ticket, undefined);
    assert.deepEqual(message.payload, { hello: 'world' });
    await close(a);
    await close(b);
  });

  await t.test('wrong secrets still deny joining and close with 1008', async () => {
    const owner = await connect();
    assert.equal((await join(owner, 'secret-room')).type, 'join_ok');
    const denied = await connect();
    const closed = once(denied, 'close', { signal: timeout() });
    const response = await join(denied, 'secret-room', 'other-device', 'wrong-secret');
    assert.equal(response.type, 'join_denied');
    assert.equal((await closed)[0], 1008);
    await health();
    await close(owner);
  });

  await t.test('rejects malformed messages before side effects and keeps the session usable', async () => {
    const ws = await connect();
    const joined = await join(ws, 'validation-room');
    assert.equal(joined.type, 'join_ok');
    const envelope = {
      version: 1, roomId: joined.roomId, deviceId: joined.deviceId, ticket: joined.ticket,
    };
    const secret = 'never-log-invalid-payload';
    const before = await health();
    const invalid = [
      null, [], { ...envelope, type: 'join_ok' },
      { ...envelope, type: 'sync_request', payload: [] },
      { ...envelope, type: 'sync_response', targetDeviceId: {} },
      { ...envelope, type: 'rekey_prepare', seq: '1' },
      { ...envelope, type: 'catchup_request', payload: { afterSeq: { valueOf: 0, toString: 0 }, secret } },
      { ...envelope, type: 'catchup_ack', payload: { throughSeq: -1 } },
      { ...envelope, type: 'push_subscribe', payload: { subscription: { endpoint: secret } } },
      { ...envelope, type: 'push_unsubscribe', payload: { extra: true } },
      { ...envelope, type: 'ticket_refresh', ticket: {} },
    ];
    for (const message of invalid) {
      const response = receive(ws);
      ws.send(JSON.stringify(message));
      const error = await response;
      assert.equal(error.type, 'error');
      assert.equal(error.payload?.code, 'invalid_event');
      assert.deepEqual(await health(), before);
    }
    const response = receive(ws);
    ws.send('{');
    assert.equal((await response).payload?.code, 'invalid_json');
    const refreshed = await exchange(ws, { ...envelope, type: 'ticket_refresh' });
    assert.equal(refreshed.type, 'ticket_refresh');
    assert.ok(!output.includes(secret));
    assert.ok(joined.ticket);
    assert.ok(!output.includes(joined.ticket));
    await close(ws);
  });

  await t.test('preserves subscription, offline delta delivery, catch-up and ACK handling', async () => {
    const a = await connect();
    const b = await connect();
    const joinedA = await join(a, 'queue-room', 'queue-a');
    const joinedB = await join(b, 'queue-room', 'queue-b');
    assert.equal(joinedA.type, 'join_ok');
    assert.equal(joinedB.type, 'join_ok');
    const authA = { version: 1, roomId: joinedA.roomId, deviceId: joinedA.deviceId, ticket: joinedA.ticket };
    b.send(JSON.stringify({
      version: 1, type: 'push_subscribe', roomId: joinedB.roomId, deviceId: joinedB.deviceId, ticket: joinedB.ticket,
      payload: {
        subscription: {
          endpoint: 'https://push.example.test/subscription',
          expirationTime: null,
          keys: { p256dh: 'public-key', auth: 'auth-key' },
        },
      },
    }));
    const initial = await exchange(b, {
      version: 1, type: 'catchup_request', roomId: joinedB.roomId, deviceId: joinedB.deviceId, ticket: joinedB.ticket,
    });
    assert.equal(initial.type, 'catchup_response');
    assert.deepEqual(initial.payload?.messages, []);
    await close(b);
    const payload = { kind: 'delta', envelope: { opId: 'queued-operation', applicationData: { value: 1 } } };
    a.send(JSON.stringify({ ...authA, type: 'sync_response', targetDeviceId: 'queue-b', payload }));
    assert.equal((await exchange(a, { ...authA, type: 'catchup_request' })).type, 'catchup_response');

    const reconnected = await connect();
    const rejoined = await join(reconnected, 'queue-room', 'queue-b');
    assert.equal(rejoined.type, 'join_ok');
    const authB = {
      version: 1, roomId: rejoined.roomId, deviceId: rejoined.deviceId, ticket: rejoined.ticket,
    };
    const catchup = await exchange(reconnected, { ...authB, type: 'catchup_request', payload: { afterSeq: 0 } });
    assert.equal(catchup.type, 'catchup_response');
    const messages = catchup.payload?.messages;
    assert.ok(Array.isArray(messages));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].payload, payload);
    assert.equal(messages[0].seq, 1);
    assert.equal(messages[0].fromDeviceId, 'queue-a');
    assert.equal((await exchange(reconnected, {
      ...authB, type: 'catchup_ack', payload: { throughSeq: '1' },
    })).payload?.code, 'invalid_event');
    const retained = await exchange(reconnected, { ...authB, type: 'catchup_request' });
    assert.deepEqual(retained.payload?.messages, messages);
    reconnected.send(JSON.stringify({ ...authB, type: 'catchup_ack', payload: { throughSeq: 1 } }));
    reconnected.send(JSON.stringify({ ...authB, type: 'push_unsubscribe' }));
    const empty = await exchange(reconnected, { ...authB, type: 'catchup_request' });
    assert.equal(empty.type, 'catchup_response');
    assert.deepEqual(empty.payload?.messages, []);
    await close(a);
    await close(reconnected);
  });

  await t.test('still checks session, room and ticket authorization after validation', async () => {
    const ws = await connect();
    const unauthenticated = await exchange(ws, {
      version: 1, type: 'ticket_refresh', roomId: 'auth-room', deviceId: 'auth-device', ticket: 'unknown',
    });
    assert.equal(unauthenticated.payload?.code, 'not_joined');
    const joined = await join(ws, 'auth-room', 'auth-device');
    assert.equal(joined.type, 'join_ok');
    const wrongRoom = await exchange(ws, {
      version: 1, type: 'ticket_refresh', roomId: 'other-room', deviceId: joined.deviceId, ticket: joined.ticket,
    });
    assert.equal(wrongRoom.payload?.code, 'invalid_event');
    const closed = once(ws, 'close', { signal: timeout() });
    const wrongTicket = await exchange(ws, {
      version: 1, type: 'ticket_refresh', roomId: joined.roomId, deviceId: joined.deviceId, ticket: 'wrong-ticket',
    });
    assert.equal(wrongTicket.payload?.code, 'invalid_ticket');
    assert.equal((await closed)[0], 1008);
    await health();
  });

  await t.test('unexpected exceptions close only the offending connection with 1011', async () => {
    const survivor = await connect();
    const offender = await connect();
    const survivorJoin = await join(survivor, 'survivor-room');
    assert.equal(survivorJoin.type, 'join_ok');
    const secret = 'never-log-this-join-secret';
    const joined = await join(offender, 'offender-room', 'fault-injection-device', secret);
    assert.equal(joined.type, 'join_ok');
    const before = await health();
    const closed = once(offender, 'close', { signal: timeout() });
    offender.send(JSON.stringify({
      version: 1,
      type: 'ticket_refresh',
      roomId: joined.roomId,
      deviceId: joined.deviceId,
      ticket: joined.ticket,
    }));
    const [code, reason] = await closed;
    assert.equal(code, 1011);
    assert.equal(String(reason), 'Internal relay error');
    let stats = await health();
    const deadline = Date.now() + 5000;
    while (stats.sessionCount !== before.sessionCount - 1 && Date.now() < deadline) {
      await delay(10);
      stats = await health();
    }
    assert.equal(stats.sessionCount, before.sessionCount - 1);
    const refreshed = await exchange(survivor, {
      version: 1,
      type: 'ticket_refresh',
      roomId: survivorJoin.roomId,
      deviceId: survivorJoin.deviceId,
      ticket: survivorJoin.ticket,
    });
    assert.equal(refreshed.type, 'ticket_refresh');
    const newcomer = await connect();
    assert.equal((await join(newcomer, 'new-room')).type, 'join_ok');
    await health();
    const errorLine = output.split('\n').find((line) => line.includes('"message":"relay message handling failed"'));
    assert.ok(errorLine, output);
    const errorLog = JSON.parse(errorLine) as Record<string, unknown>;
    assert.equal(errorLog.level, 'error');
    assert.equal(errorLog.error, 'TypeError');
    assert.equal(typeof errorLog.sessionId, 'string');
    assert.ok(!output.includes(secret));
    assert.ok(joined.ticket);
    assert.ok(!output.includes(joined.ticket));
    await close(survivor);
    await close(newcomer);
  });
});
