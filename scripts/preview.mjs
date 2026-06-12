import { spawn } from 'node:child_process';

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

const start = (name, args) => {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
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

children.push(start('relay', ['run', '-w', 'relay', 'start']));
children.push(start('app preview', ['run', '-w', 'app', 'preview']));
