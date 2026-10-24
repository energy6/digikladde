import { isSecret } from './e2eCrypto';

export interface ParsedJoinInvite {
  version: 2;
  inviteId: string;
  key: string;
}

export const parseJoinInvite = (rawValue: string): ParsedJoinInvite | null => {
  try {
    const fragment = rawValue.startsWith('#')
      ? rawValue.slice(1)
      : new URL(rawValue).hash.slice(1);
    const params = new URLSearchParams(fragment.startsWith('/?') ? fragment.slice(2) : fragment);
    const inviteId = params.get('invite');
    const key = params.get('key');
    if (params.get('v') !== '2' || !isSecret(inviteId) || !isSecret(key) || params.size !== 3) return null;
    return { version: 2, inviteId, key };
  } catch {
    return null;
  }
};
