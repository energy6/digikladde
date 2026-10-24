export type RelayEventType =
  | 'join_request'
  | 'join_ok'
  | 'join_denied'
  | 'ticket_refresh'
  | 'catchup_request'
  | 'catchup_response'
  | 'catchup_ack'
  | 'push_subscribe'
  | 'push_unsubscribe'
  | 'sync_request'
  | 'sync_response'
  | 'error';

export type RelayEnvelope = {
  version: 2;
  type: RelayEventType;
  roomId?: string;
  deviceId?: string;
  ticket?: string;
  seq?: number;
  targetDeviceId?: string;
  payload?: Record<string, unknown>;
};

export type QueuedRelayMessage = {
  seq: number;
  ts: number;
  fromDeviceId: string;
  type: 'sync_response';
  payload: Record<string, unknown>;
};

export type CatchupResponsePayload = {
  messages: QueuedRelayMessage[];
};

export type RelayErrorCode =
  | 'invalid_json'
  | 'invalid_event'
  | 'not_joined'
  | 'invalid_ticket'
  | 'join_denied'
  | 'rate_limited'
  | 'room_full'
  | 'unsupported_path';

export type RelayConfig = {
  host: string;
  port: number;
  wsPath: string;
  maxPayloadBytes: number;
  maxConnectionsPerIp: number;
  maxEventsPerMinutePerIp: number;
  maxJoinPerMinutePerRoom: number;
  maxParticipantsPerRoom: number;
  heartbeatIntervalMs: number;
  idleTimeoutMs: number;
  ticketTtlMs: number;
  messageBufferLimitPerRoom: number;
  queueRetentionMs: number;
  webPushPublicKey?: string;
  webPushPrivateKey?: string;
  webPushSubject?: string;
};
export type {
  JoinRequestPayload,
  CatchupRequestPayload,
  CatchupAckPayload,
  PushSubscriptionPayload,
} from './protocol.js';
