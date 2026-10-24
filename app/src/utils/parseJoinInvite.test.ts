import { expect, it } from 'vitest';
import { randomSecret } from './e2eCrypto';
import { parseJoinInvite } from './parseJoinInvite';

it('parses only V2 fragment links and QR payloads without HTTP query secrets', () => {
  const inviteId = randomSecret();
  const key = randomSecret();
  const link = new URL('https://example.test/digikladde/');
  link.hash = new URLSearchParams({ v: '2', invite: inviteId, key }).toString();
  expect(link.search).toBe('');
  expect(parseJoinInvite(link.toString())).toEqual({ version: 2, inviteId, key });
  expect(parseJoinInvite(link.hash)).toEqual({ version: 2, inviteId, key });
});

it.each([
  '', '{', 'https://example.com', '{"type":"digikladde_join","version":1,"roomId":"room","joinSecret":"secret"}',
  'roomId=room\njoinSecret=secret', '#v=1&invite=id&key=key',
  '#v=2&invite=short&key=short',
])('rejects malformed and legacy invitation %s', (input) => {
  expect(parseJoinInvite(input)).toBeNull();
});
