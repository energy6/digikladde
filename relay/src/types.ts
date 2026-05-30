export type RelayEventType =
  | 'join_request'
  | 'join_ok'
  | 'join_denied'
  | 'ticket_refresh'
  | 'peer_key_request'
  | 'peer_key_response'
  | 'sync_request'
  | 'sync_response'
  | 'rekey_prepare'
  | 'rekey_ack'
  | 'rekey_commit'
  | 'error';

export type RelayEnvelope = {
  version: 1;
  type: RelayEventType;
  roomId?: string;
  deviceId?: string;
  ticket?: string;
  seq?: number;
  targetDeviceId?: string;
  payload?: Record<string, unknown>;
};

export type JoinRequestPayload = {
  roomId: string;
  deviceId: string;
  joinSecret: string;
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
};
