import { z } from 'zod';

const identifier = z.string().min(1);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const objectPayload = z.record(z.string(), z.unknown());

export const joinRequestPayloadSchema = z.strictObject({
  roomId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  joinSecret: z.string().trim().min(1),
});

export const catchupRequestPayloadSchema = z.strictObject({
  afterSeq: sequence.optional(),
});

export const catchupAckPayloadSchema = z.strictObject({
  throughSeq: sequence,
});

export const pushSubscriptionPayloadSchema = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }),
  expirationTime: sequence.nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const envelopeFields = {
  version: z.literal(1),
  roomId: identifier.optional(),
  deviceId: identifier.optional(),
  ticket: identifier.optional(),
  seq: sequence.optional(),
  targetDeviceId: identifier.optional(),
};

const joinedFields = {
  ...envelopeFields,
  roomId: identifier,
  deviceId: identifier,
  ticket: identifier,
};

export const clientEnvelopeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelopeFields,
    type: z.literal('join_request'),
    payload: joinRequestPayloadSchema,
  }),
  z.strictObject({
    ...joinedFields,
    type: z.literal('ticket_refresh'),
    payload: z.strictObject({}).optional(),
  }),
  z.strictObject({
    ...joinedFields,
    type: z.literal('catchup_request'),
    payload: catchupRequestPayloadSchema.optional(),
  }),
  z.strictObject({
    ...joinedFields,
    type: z.literal('catchup_ack'),
    payload: catchupAckPayloadSchema,
  }),
  z.strictObject({
    ...joinedFields,
    type: z.literal('push_subscribe'),
    payload: z.strictObject({ subscription: pushSubscriptionPayloadSchema }),
  }),
  z.strictObject({
    ...joinedFields,
    type: z.literal('push_unsubscribe'),
    payload: z.strictObject({}).optional(),
  }),
  z.strictObject({
    ...joinedFields,
    type: z.enum([
      'peer_key_request',
      'peer_key_response',
      'sync_request',
      'sync_response',
      'rekey_prepare',
      'rekey_ack',
      'rekey_commit',
    ]),
    payload: objectPayload.optional(),
  }),
]);

export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;
export type ClientMessage<T extends ClientEnvelope['type']> = ClientEnvelope & { type: T };
export type JoinRequestPayload = z.infer<typeof joinRequestPayloadSchema>;
export type CatchupRequestPayload = z.infer<typeof catchupRequestPayloadSchema>;
export type CatchupAckPayload = z.infer<typeof catchupAckPayloadSchema>;
export type PushSubscriptionPayload = z.infer<typeof pushSubscriptionPayloadSchema>;
