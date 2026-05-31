#!/usr/bin/env node
/* Orchestriert Preview-Server-Start, Capture-Durchführung und Server-Shutdown */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../../');
const captureScriptPath = join(__dirname, 'capture-guide-media.mjs');

const PREVIEW_PORT = 4173;
const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;
const PREVIEW_STARTUP_TIMEOUT = 30000; // 30 Sekunden
const PREVIEW_READY_CHECK_INTERVAL = 500; // 500ms

const waitForPreviewReady = async () => {
  console.log(`\nWarte darauf, dass Preview-Server auf ${PREVIEW_URL} bereit ist...`);
  const startedAt = Date.now();

  while (Date.now() - startedAt < PREVIEW_STARTUP_TIMEOUT) {
    try {
      const response = await fetch(PREVIEW_URL, { method: 'GET', timeout: 2000 });
      if (response.ok || response.status < 500) {
        console.log('✓ Preview-Server ist bereit.\n');
        return true;
      }
    } catch {
      // Server antwortet noch nicht, weitermachen
    }

    await delay(PREVIEW_READY_CHECK_INTERVAL);
  }

  throw new Error(`Preview-Server wurde nach ${PREVIEW_STARTUP_TIMEOUT}ms nicht bereit`);
};

const runCommand = (command, args, label) => {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${label}...`);
    const proc = spawn(command, args, { stdio: 'inherit', shell: true, cwd: rootDir });

    proc.on('error', (error) => {
      reject(new Error(`${label} fehlgeschlagen: ${error.message}`));
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`${label} beendet mit Exit-Code ${code}`));
      } else {
        resolve();
      }
    });
  });
};

try {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('DigiKladde Screenshot-Capture mit Preview-Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Build erstellen
  await runCommand('npm', ['run', '-w', 'app', 'build'], '📦 Erstelle Build');

  // 2. Preview-Server starten (im Hintergrund)
  const previewProc = spawn('npm', ['run', '-w', 'app', 'preview', '--', '--host', PREVIEW_HOST, '--port', PREVIEW_PORT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: rootDir,
  });

  let previewStarted = false;
  previewProc.stdout?.on('data', (data) => {
    const output = data.toString();
    if (output.includes('Local:') || output.includes('➜')) {
      previewStarted = true;
    }
  });

  previewProc.stderr?.on('data', (data) => {
    const output = data.toString();
    if (!output.includes('EADDRINUSE')) {
      // Ignoriere Port-bereits-in-Benutzung-Fehler nur kurz
      console.error(`Preview stderr: ${output}`);
    }
  });

  previewProc.on('error', (error) => {
    console.error(`Preview-Prozess Fehler: ${error.message}`);
  });

  previewProc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.warn(`Preview-Server beendet mit Code ${code}`);
    }
  });

  // 3. Warten bis Preview bereit ist
  await delay(1000); // Kurze Initialpause
  await waitForPreviewReady();

  // 4. Capture durchführen
  try {
    await runCommand('node', [captureScriptPath], '📸 Führe Capture durch');
    console.log('\n✓ Capture erfolgreich abgeschlossen!');
  } finally {
    // 5. Preview-Server beenden
    console.log('\n🛑 Beende Preview-Server...');
    previewProc.kill();
    await delay(1000);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✓ Fertig!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} catch (error) {
  console.error(`\n✗ Fehler: ${error.message}`);
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(1);
}
