import { addStudent, createCourse, expect, readRecords, shareCourse, studentRow, test } from './fixtures';
import { encryptBox, isRecord, randomSecret } from '../src/utils/e2eCrypto';
import { test as browserTest } from '@playwright/test';

test('keeps sync, push and invitation contents opaque and consumes invitation links once', async ({ teachers: { start, landing }, browser }) => {
  const transport: string[] = [];
  start.on('websocket', (socket) => socket.on('framesent', (frame) => {
    const text = String(frame.payload);
    const value = JSON.parse(text) as { type?: string };
    if (value.type === 'sync_request' || value.type === 'sync_response') transport.push(text);
  }));
  start.on('request', (request) => {
    if (request.url().includes('/invites')) transport.push(request.postData() ?? '');
  });
  await createCourse(start, 'PrivateCourseMarker');
  await addStudent(start, 'Anna');
  await addStudent(start, 'Ben');
  const link = await shareCourse(start, landing);
  expect(new URL(link).search).toBe('');
  expect(landing.url()).not.toContain('invite=');
  expect(landing.url()).not.toContain('key=');
  await addStudent(start, 'PrivateStudentMarker');
  await expect(studentRow(landing, 'PrivateStudentMarker')).toBeVisible();
  const capture = transport.join('\n');
  expect(transport.length).toBeGreaterThan(2);
  for (const marker of ['PrivateCourseMarker', 'PrivateStudentMarker', '"Anna"', '"Ben"', 'Startlehrer']) {
    expect(capture).not.toContain(marker);
  }
  const roomKeys = await readRecords(start, 'roomKeys');
  if (!Array.isArray(roomKeys) || roomKeys.length === 0) throw new Error('Keys unavailable');
  for (const key of roomKeys) {
    if (!isRecord(key) || typeof key.secret !== 'string') throw new Error('Invalid test key');
    expect(capture).not.toContain(key.secret);
  }
  expect(capture).not.toContain(new URLSearchParams(new URL(link).hash.slice(3)).get('key'));

  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const outsider = await context.newPage();
    await outsider.goto(link);
    await expect(outsider.getByText('Einladung ist verbraucht oder nicht mehr verfügbar.')).toBeVisible();
    expect(await readRecords(outsider, 'courses')).toEqual([]);
  } finally {
    await context.close();
  }

  const catchups: unknown[] = [];
  landing.on('websocket', (socket) => socket.on('framereceived', (frame) => {
    const value = JSON.parse(String(frame.payload)) as { type?: string; payload?: { messages?: unknown[] } };
    if (value.type === 'catchup_response' && value.payload?.messages?.length) catchups.push(value.payload.messages);
  }));
  await landing.goto('about:blank');
  await addStudent(start, 'OfflineStudentMarker');
  await landing.goto('./');
  await landing.getByRole('main').getByRole('heading', { level: 3 }).click();
  await expect(studentRow(landing, 'OfflineStudentMarker')).toBeVisible();
  expect(catchups.length).toBeGreaterThan(0);
});

test('rejoins an existing course with a fresh invitation without duplicating it or resetting the room', async ({ teachers: { start, landing } }) => {
  await createCourse(start, 'RejoinMarker');
  await addStudent(start, 'Anna');
  await addStudent(start, 'Ben');
  await shareCourse(start, landing);
  await expect(start.getByRole('button', { name: 'Reset shared room' })).toHaveCount(0);
  await expect(start.getByRole('button', { name: 'Neuer Raum', exact: true })).toHaveCount(0);
  const sessions = await readRecords(landing, 'shareSessions');
  if (!Array.isArray(sessions) || !isRecord(sessions[0])) throw new Error('Session unavailable');
  await shareCourse(start, landing);
  expect(await readRecords(landing, 'shareSessions')).toEqual(expect.arrayContaining([
    expect.objectContaining({ roomId: sessions[0].roomId, state: 'connected' }),
  ]));
  const resync = landing.getByRole('button', { name: 'Resync course', exact: true });
  await resync.click();
  await expect(resync).not.toBeDisabled();
  await addStudent(start, 'RejoinedStudentMarker');
  await expect(studentRow(landing, 'RejoinedStudentMarker')).toBeVisible();
  expect(await readRecords(landing, 'courses')).toHaveLength(1);
  expect(await readRecords(landing, 'roomKeys')).toHaveLength(1);
  expect(sessions).toHaveLength(1);
});

test('reports automatic reconnect failures without uncaught errors or toasts and recovers', async ({ teachers: { start, landing } }) => {
  await createCourse(start, 'ReconnectMarker');
  await addStudent(start, 'Anna');
  await addStudent(start, 'Ben');
  await shareCourse(start, landing);
  const keys = await readRecords(landing, 'roomKeys');
  const replay = await readRecords(landing, 'receivedMessages');
  const warnings: string[] = [];
  landing.on('console', (entry) => { if (entry.type() === 'warning') warnings.push(entry.text()); });
  await landing.goto('about:blank');
  let attempts = 0;
  let mode: 'close' | 'deny' | 'pending' | 'available' = 'close';
  await landing.routeWebSocket('**/relay', (socket) => {
    attempts += 1;
    if (mode === 'available') socket.connectToServer();
    else if (mode === 'close') socket.onMessage(() => socket.close({ code: 1011, reason: 'Synthetic relay failure' }));
    else if (mode === 'deny') socket.onMessage(() => socket.send(JSON.stringify({ version: 2, type: 'join_denied' })));
  });
  await landing.goto('./');
  await expect.poll(() => readRecords(landing, 'shareSessions')).toEqual([
    expect.objectContaining({ state: 'error' }),
  ]);
  await expect.poll(() => warnings).toContain('Sync: Automatische Verbindung fehlgeschlagen.');
  await landing.clock.fastForward(1000);
  await expect.poll(() => attempts).toBeGreaterThanOrEqual(2);
  await expect.poll(() => readRecords(landing, 'shareSessions')).toEqual([
    expect.objectContaining({ state: 'error' }),
  ]);
  expect(await readRecords(landing, 'roomKeys')).toEqual(keys);
  expect(await readRecords(landing, 'receivedMessages')).toEqual(replay);
  await landing.getByRole('main').getByRole('heading', { level: 3 }).click();
  await expect(landing.getByText('Fehler', { exact: true })).toBeVisible();
  await expect(landing.locator('.ant-message-error')).toHaveCount(0);
  mode = 'deny';
  await landing.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => warnings).toContain('Sync: Relay-Anfrage abgelehnt.');
  await expect.poll(() => readRecords(landing, 'shareSessions')).toEqual([
    expect.objectContaining({ state: 'error' }),
  ]);
  await expect(landing.locator('.ant-message-error')).toHaveCount(0);
  mode = 'pending';
  await landing.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => readRecords(landing, 'shareSessions')).toEqual([
    expect.objectContaining({ state: 'connecting' }),
  ]);
  mode = 'available';
  await landing.getByRole('button', { name: 'Resync course', exact: true }).click();
  await expect.poll(() => readRecords(landing, 'shareSessions')).toEqual([
    expect.objectContaining({ state: 'connected' }),
  ]);
  await addStudent(start, 'RecoveredStudentMarker');
  await expect(studentRow(landing, 'RecoveredStudentMarker')).toBeVisible();
  await landing.goto('./');
  await landing.getByRole('button', { name: 'Delete courses', exact: true }).click();
  await landing.getByRole('checkbox').check();
  await landing.getByRole('button', { name: 'Delete courses', exact: true }).click();
  await landing.getByRole('dialog', { name: 'Kurse löschen' }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => readRecords(landing, 'courses')).toEqual([]);
  for (const table of ['shareSessions', 'roomKeys', 'receivedMessages'] as const) {
    expect(await readRecords(landing, table)).toEqual([]);
  }
  const attemptsAfterLeave = attempts;
  await landing.clock.fastForward(60_000);
  expect(attempts).toBe(attemptsAfterLeave);
});

browserTest('decrypts detailed push in the real service worker with no open app tab', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto('./');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const key = { roomId: 'push-test-room', courseSyncId: 'course', epoch: 'epoch', secret: randomSecret(), sentCount: 0 };
    await page.evaluate((roomKey) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('DigiKladdeDB');
      open.onerror = () => reject(new Error('Database unavailable'));
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction('roomKeys', 'readwrite');
        tx.objectStore('roomKeys').put(roomKey);
        tx.oncomplete = () => { database.close(); resolve(); };
        tx.onerror = () => { database.close(); reject(new Error('Could not persist test key')); };
      };
    }), key);
    const detail = { title: 'DigiKladde', body: 'SyntheticStudent gestartet (SyntheticCourse)' };
    const box = await encryptBox(key.secret, {
      version: 2, roomId: key.roomId, courseSyncId: key.courseSyncId, epoch: key.epoch,
      deviceId: 'sender', messageId: 'push-message', purpose: 'push',
    }, detail);
    const worker = context.serviceWorkers()[0];
    expect(worker).toBeDefined();
    await worker.evaluate(() => {
      const scope = globalThis as typeof globalThis & {
        registration: ServiceWorkerRegistration;
        __notifications: { title: string; body: string }[];
      };
      scope.__notifications = [];
      // Native notifications are denied on some headless/OS configurations.
      scope.registration.showNotification = (title, options) => {
        scope.__notifications.push({ title, body: options?.body ?? '' });
        return Promise.resolve();
      };
    });
    await page.goto('about:blank');
    const dispatchPush = (payload: unknown) => worker.evaluate(async (data) => {
      const scope = globalThis as typeof globalThis & {
        PushEvent: new (type: string, init: { data: string }) => Event & { waitUntil: (task: Promise<unknown>) => void };
      };
      const event = new scope.PushEvent('push', { data });
      const tasks: Promise<unknown>[] = [];
      // Synthetic push events need an explicit lifetime; the production handler and APIs are real.
      event.waitUntil = (task) => { tasks.push(task); };
      globalThis.dispatchEvent(event);
      await Promise.all(tasks);
    }, JSON.stringify(payload));
    await dispatchPush({ version: 2, roomId: key.roomId, box });
    await expect.poll(() => worker.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __notifications: { body: string }[] };
      return scope.__notifications.map((notification) => notification.body);
    })).toEqual([detail.body]);
    await dispatchPush({ version: 2, roomId: key.roomId, box });
    expect(await worker.evaluate(() => (
      globalThis as typeof globalThis & { __notifications: unknown[] }
    ).__notifications.length)).toBe(1);
    await dispatchPush({ version: 2, roomId: key.roomId, box: { ...box, iv: 'AAAAAAAAAAAAAAAA' } });
    await expect.poll(() => worker.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __notifications: { body: string }[] };
      return scope.__notifications.map((notification) => notification.body);
    })).toEqual([detail.body, 'Neue Kursdaten verfügbar.']);
  } finally {
    await context.close();
  }
});
