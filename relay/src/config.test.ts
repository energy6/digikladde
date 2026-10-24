import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import type { RelayConfig } from './types.js';

const readConfig = (overrides: Record<string, string> = {}): RelayConfig => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RELAY_')));
  const output = execFileSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '-e',
    "import { relayConfig } from './src/config.ts'; console.log(JSON.stringify(relayConfig));",
  ], { cwd: new URL('..', import.meta.url), env: { ...env, ...overrides }, encoding: 'utf8' });
  return JSON.parse(output) as RelayConfig;
};

void test('uses defaults independently of the parent environment', () => {
  const config = readConfig();
  assert.equal(config.port, 8080);
  assert.equal(config.wsPath, '/relay');
  assert.equal(config.queueRetentionMs, 86_400_000);
  assert.equal(config.webPushPrivateKey, undefined);
});

void test('normalizes paths and applies valid numeric settings', () => {
  const config = readConfig({ RELAY_PORT: '9090', RELAY_WS_PATH: 'custom', RELAY_TICKET_TTL_MS: '60000' });
  assert.equal(config.port, 9090);
  assert.equal(config.wsPath, '/custom');
  assert.equal(config.ticketTtlMs, 60_000);
});

void test('falls back on invalid or nonpositive numeric values', () => {
  for (const value of ['invalid', '0', '-1']) assert.equal(readConfig({ RELAY_PORT: value }).port, 8080);
});
