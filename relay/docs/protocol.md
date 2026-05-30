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

## Relay Notes

- First join request creates a room with `joinSecret`.
- Further joins must present matching `joinSecret`.
- Tickets are short-lived and refreshed by `ticket_refresh`.
- Relay may buffer recent ciphertext events per room.
