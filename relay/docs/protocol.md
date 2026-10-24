# Relay Protocol V1

All websocket messages are JSON with this envelope:

```json
{
  "version": 1,
  "type": "join_request",
  "roomId": "room-123",
  "deviceId": "device-abc",
  "ticket": "optional",
  "seq": 1,
  "targetDeviceId": "optional",
  "payload": {}
}
```

## Required Events

- `join_request`: Client asks to join room with payload `{ roomId, deviceId, joinSecret }`.
- `join_ok`: Relay confirms join and returns `ticket` + expiration timestamp.
- `join_denied`: Join was rejected (for example wrong secret).
- `ticket_refresh`: Client requests or receives a new ticket.
- `catchup_request`: Client asks the relay for queued sync deltas after payload `{ afterSeq }`.
- `catchup_response`: Relay returns payload `{ messages }` with queued `sync_response` delta messages for the requesting device.
- `catchup_ack`: Client confirms queued sync deltas were applied with payload `{ throughSeq }`.
- `push_subscribe`: Client registers a Web Push subscription for the joined room/device with payload `{ subscription }`.
- `push_unsubscribe`: Client removes the Web Push subscription for the joined room/device.
- `peer_key_request`: Forwarded to peers.
- `peer_key_response`: Forwarded to peers.
- `sync_request`: Forwarded to peers.
- `sync_response`: Forwarded to peers.
- `rekey_prepare`: Forwarded to peers.
- `rekey_ack`: Forwarded to peers.
- `rekey_commit`: Forwarded to peers.
- `error`: Relay-side validation or authorization error.

## Authorization Rules

- Only `join_request` is accepted before a session joined a room.
- All other events require valid `roomId`, `deviceId` and current session `ticket`.
- Relay never inspects E2E payload content.

## Incoming Message Validation

The relay validates every client message with Zod before dispatching it or
changing room state. TypeScript input types are inferred from these schemas.
Invalid JSON receives `invalid_json`; valid JSON that does not match a client
message schema receives `invalid_event`. Validation errors do not close the
connection or echo payloads, secrets, tickets, or detailed schema errors.

- Only the client events listed above are accepted; `join_ok`, `join_denied`,
  `catchup_response`, and `error` are server-only.
- Envelope and relay-control payload objects reject unknown fields.
- Join payload strings are trimmed and must be nonempty. Other identifiers and
  tickets must be nonempty strings and are not coerced or normalized.
- Every non-join message requires `roomId`, `deviceId`, and `ticket`. Session
  authorization is checked separately after structural validation.
- `seq`, `afterSeq`, and `throughSeq` must be nonnegative safe integers, without
  string coercion or rounding. An omitted catch-up request payload or `afterSeq`
  starts at zero; an ACK must explicitly provide `throughSeq`.
- `ticket_refresh` and `push_unsubscribe` accept no payload or an empty object.
- Push subscriptions require an HTTPS URL, nonempty key strings, and an optional
  null or nonnegative safe integer expiration timestamp.
- Forwarded peer/sync/rekey payloads may be omitted or contain an object.
  Their application-specific contents are preserved, not validated by the relay.
- The existing `RELAY_MAX_PAYLOAD_BYTES` limit bounds each WebSocket message;
  schema validation does not add cumulative queue or room budgets.

These schemas do not provide course authorization, trusted proxy handling,
SSRF-safe push delivery, or end-to-end encryption. HTTPS URL validation alone
does not establish that a push destination is safe.

## Relay Notes

- First join request creates a room with `joinSecret`.
- Further joins must present matching `joinSecret`.
- Tickets are short-lived and refreshed by `ticket_refresh`.
- Relay keeps an in-memory per-device catch-up queue for `sync_response` delta messages. The default retention is 24 hours.
- Queues and push subscriptions are intentionally in-memory and are lost when the relay process restarts.
- Web Push notifications are only a nudge that queued updates exist. Clients must still reconnect and request catch-up data.
- Web Push requires HTTPS, notification permission, and a service worker. On iOS/iPadOS, browser Web Push is available for installed Home Screen web apps, not ordinary Safari tabs.
