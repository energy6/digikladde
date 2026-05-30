import WebSocket from 'ws';

const host = process.env.RELAY_SMOKE_URL ?? 'ws://127.0.0.1:8080/relay';
const roomId = `smoke-${Date.now()}`;
const joinSecret = 'smoke-secret';

const connectClient = (deviceId) => new Promise((resolve, reject) => {
  const ws = new WebSocket(host);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      version: 1,
      type: 'join_request',
      payload: { roomId, deviceId, joinSecret },
    }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'join_ok') {
      resolve({ ws, ticket: msg.ticket, roomId, deviceId });
    }
  });

  ws.on('error', reject);
});

const run = async () => {
  const a = await connectClient('teacher-a');
  const b = await connectClient('teacher-b');

  const received = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for forwarded message')), 5000);

    b.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'peer_key_request') {
        clearTimeout(timeout);
        resolve(msg);
      }
    });

    a.ws.send(JSON.stringify({
      version: 1,
      type: 'peer_key_request',
      roomId,
      deviceId: 'teacher-a',
      ticket: a.ticket,
      payload: { hello: 'world' },
    }));
  });

  console.log('Smoke success:', received);
  a.ws.close();
  b.ws.close();
};

run().catch((error) => {
  console.error('Smoke failed:', error);
  process.exit(1);
});
