import { expect, it } from 'vitest';
import { parseJoinInvite } from './parseJoinInvite';

it('parses shared JSON and legacy invitations', () => {
  const expected = { roomId: 'room', joinSecret: 'secret', courseSyncId: 'course' };
  expect(parseJoinInvite(JSON.stringify({ type: 'digikladde_join', version: 1, roomId: ' room ', joinSecret: ' secret ', courseSyncId: 'course' }))).toEqual(expected);
  expect(parseJoinInvite('roomId=room\njoinSecret=secret\ncourseSyncId=course')).toEqual(expected);
  const link = new URL('http://127.0.0.1:4173/');
  link.searchParams.set('joinInvite', JSON.stringify({ type: 'digikladde_join', version: 1, ...expected }));
  expect(parseJoinInvite(link.searchParams.get('joinInvite')!)).toEqual(expected);
});

it.each(['', '{', 'https://example.com', '{"type":"other"}', '{"type":"digikladde_join","roomId":"room"}'])(
  'rejects incomplete or malformed invitation %s', (input) => {
    expect(parseJoinInvite(input)).toBeNull();
  },
);
