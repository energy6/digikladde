export type MessagePurpose = 'delta' | 'snapshot' | 'snapshot_request' | 'push' | 'invite';

export interface BoxContext {
  version: 2;
  roomId: string;
  courseSyncId: string;
  deviceId: string;
  messageId: string;
  epoch: string;
  purpose: MessagePurpose;
}

export interface EncryptedBox extends BoxContext {
  iv: string;
  ciphertext: string;
}

const purposes: readonly string[] = ['delta', 'snapshot', 'snapshot_request', 'push', 'invite'];
const encoder = new TextEncoder();
export const INVITE_TTL_MS = 10 * 60 * 1000;
export const MAX_KEY_MESSAGES = 2 ** 24;
export const MAX_PUSH_BYTES = 2800;
export const MAX_SYNC_BYTES = 176 * 1024;

export const requireCrypto = (): Crypto => {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('Sicheres Teilen benötigt HTTPS und Web Crypto.');
  }
  return globalThis.crypto;
};

export const toBase64Url = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Ungültige E2E-Kodierung.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const result = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
  if (toBase64Url(result) !== value) throw new Error('Nicht kanonische E2E-Kodierung.');
  return result;
};

export const randomSecret = (): string => toBase64Url(requireCrypto().getRandomValues(new Uint8Array(32)));
export const isSecret = (value: unknown): value is string => (
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
);
export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const isEncryptedBox = (value: unknown): value is EncryptedBox => {
  if (!isRecord(value)) return false;
  const keys = ['version', 'roomId', 'courseSyncId', 'deviceId', 'messageId', 'epoch', 'purpose', 'iv', 'ciphertext'];
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
    && value.version === 2 && purposes.includes(String(value.purpose))
    && ['roomId', 'courseSyncId', 'deviceId', 'messageId', 'epoch'].every((key) => (
      typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 256
    ))
    && typeof value.iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(value.iv)
    && typeof value.ciphertext === 'string' && /^[A-Za-z0-9_-]{22,}$/.test(value.ciphertext);
};

const associatedData = (context: BoxContext): Uint8Array<ArrayBuffer> => encoder.encode(JSON.stringify([
  context.version, context.roomId, context.courseSyncId, context.deviceId,
  context.messageId, context.epoch, context.purpose,
]));

const deriveKey = async (secret: string, context: BoxContext): Promise<CryptoKey> => {
  const crypto = requireCrypto();
  const bytes = fromBase64Url(secret);
  if (bytes.length !== 32) throw new Error('Ungültiger E2E-Schlüssel.');
  const root = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  const domain = context.purpose === 'push' ? 'push' : context.purpose === 'invite' ? 'invite' : 'sync';
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: encoder.encode(JSON.stringify([context.roomId, context.courseSyncId, context.epoch])),
    info: encoder.encode(JSON.stringify(['digikladde/v2', domain, context.deviceId])),
  }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

export const encryptBox = async (secret: string, context: BoxContext, value: unknown): Promise<EncryptedBox> => {
  const crypto = requireCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, context);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: associatedData(context),
  }, key, encoder.encode(JSON.stringify(value)));
  return { ...context, iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
};

export const decryptBox = async (
  secret: string, value: unknown, expected: Partial<BoxContext>,
): Promise<{ box: EncryptedBox; value: unknown }> => {
  if (!isEncryptedBox(value)) throw new Error('Ungültiges verschlüsseltes Nachrichtenformat.');
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key as keyof BoxContext] !== expectedValue) throw new Error('E2E-Nachricht gehört nicht zu dieser Sitzung.');
  }
  const key = await deriveKey(secret, value);
  const plaintext = await requireCrypto().subtle.decrypt({
    name: 'AES-GCM', iv: fromBase64Url(value.iv), additionalData: associatedData(value),
  }, key, fromBase64Url(value.ciphertext));
  return { box: value, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown };
};

export const assertMessageSize = (value: unknown, maxBytes: number): void => {
  if (encoder.encode(JSON.stringify(value)).byteLength > maxBytes) {
    throw new Error('Verschlüsselte Nachricht ist zu groß.');
  }
};
