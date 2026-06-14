import { spawn } from 'node:child_process';
import webPush from 'web-push';

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? `exit code ${code}`}`));
  });
});

const start = (name, args, options = {}) => {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${name} stopped with ${signal ?? `exit code ${code}`}`);
    shutdown(code ?? 1);
  });

  return child;
};

let shuttingDown = false;
const children = [];

const getRelayWebPushEnv = () => {
  const publicKey = process.env.RELAY_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.RELAY_WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.RELAY_WEB_PUSH_SUBJECT?.trim();

  if (publicKey && privateKey && subject) {
    return {};
  }

  const vapidKeys = webPush.generateVAPIDKeys();
  console.info('Preview: generated ephemeral Web Push VAPID keys for relay.');

  return {
    RELAY_WEB_PUSH_PUBLIC_KEY: vapidKeys.publicKey,
    RELAY_WEB_PUSH_PRIVATE_KEY: vapidKeys.privateKey,
    RELAY_WEB_PUSH_SUBJECT: subject || 'mailto:preview@digikladde.local',
  };
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }

  setTimeout(() => {
    process.exit(code);
  }, 250);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await run('npm', ['run', '-w', 'app', 'build']);
await run('npm', ['run', '-w', 'relay', 'build']);

children.push(start('relay', ['run', '-w', 'relay', 'start'], {
  env: {
    ...process.env,
    ...getRelayWebPushEnv(),
  },
}));
children.push(start('app preview', ['run', '-w', 'app', 'preview']));
