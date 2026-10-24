# Relay Protocol V2

V2 replaces the plaintext V1 sync protocol. Upgrade app and relay together.
V1 clients and invitations are rejected. The database upgrade removes old sharing
sessions and sync events while retaining local courses, students and flights.
Courses become local-only until shared again in a new encrypted room.

## WebSocket envelope

```json
{
  "version": 2,
  "type": "sync_response",
  "roomId": "opaque-room-id",
  "deviceId": "opaque-device-id",
  "ticket": "session-ticket",
  "seq": 1,
  "targetDeviceId": "optional-recipient",
  "payload": {
    "box": {
      "version": 2,
      "roomId": "opaque-room-id",
      "courseSyncId": "opaque-course-id",
      "deviceId": "opaque-device-id",
      "messageId": "unique-message-id",
      "epoch": "opaque-key-epoch",
      "purpose": "delta",
      "iv": "base64url-96-bit-iv",
      "ciphertext": "base64url-ciphertext-and-gcm-tag"
    }
  }
}
```

The box has exactly these nine fields. `payload` may additionally contain
`push`, an encrypted box with purpose `push` and the same bindings/message ID
as its delta. No plaintext notification, operation, snapshot or entity payload
is accepted.

## Encryption

The creating device generates an independent random 256-bit room root secret,
epoch and relay join credential using Web Crypto. The relay knows only the
join credential, never the root secret.

Clients derive non-exportable AES-256-GCM keys with HKDF-SHA-256:

- Salt: UTF-8 JSON array `[roomId, courseSyncId, epoch]`.
- Info: UTF-8 JSON array `["digikladde/v2", domain, deviceId]`.
- Domain: `sync` for deltas, snapshots and requests; `push` for notification
  details; `invite` for separately keyed invitation packages.
- AEAD additional data: UTF-8 JSON array
  `[2, roomId, courseSyncId, deviceId, messageId, epoch, purpose]`.
- A new random 96-bit IV for every encryption, including retries.
- Ciphertext includes the default 128-bit GCM tag; binary fields use canonical
  unpadded base64url.

Keys are separated by purpose domain and sender. Each device reserves usage in
IndexedDB before encrypting and refuses further messages at `2^24` encryptions
per local room key (all domains combined). Sharing stops explicitly at this
limit; this release provides no room-reset or key-rotation UI.
Message IDs identify operations, not encryption attempts. Re-encrypting a
retried operation uses a fresh IV but preserves its message ID.

All authorized participants know the root secret. Authentication proves
possession of the room secret, not individual authorship or writing permissions.
There is no forward secrecy, participant-revocation workflow or key-rotation
UI. An existing participant cannot be excluded from its room using this release.
Previously received data cannot be recalled.

## Events and authorization

- `join_request`: `{ roomId, deviceId, joinSecret }`; the first join creates the
  room. Following joins must present the same independent relay credential.
- `join_ok` / `join_denied`: confirmation with a session-bound ticket and
  `ticketExpiresAt`/`serverTime`, or denial.
- `ticket_refresh`: replaces the ticket; clients refresh halfway through its
  lifetime.
- `sync_request`: encrypted `snapshot_request` box; plaintext is
  `{ "mode": "snapshot_request" }`.
- `sync_response`: encrypted `snapshot` or `delta` box. Inner snapshots and
  delta envelopes retain their existing application schema V1; that does not
  permit V1 transport.
- `catchup_request`: `{ afterSeq }`, default zero. Clients start from zero on
  reconnect because relay queues do not survive restarts.
- `catchup_response`: `{ messages }`, ordered per-device queued delta messages.
- `catchup_ack`: `{ throughSeq }`, only after successfully processing all
  returned messages up to that sequence.
- `push_subscribe`: `{ subscription }`, standard Web Push subscription.
- `push_unsubscribe`: removes the joined device's room subscription.
- `error`: structured non-sensitive error code/message.

Except for join, client messages require matching room/device and a valid
current ticket. The relay strips tickets before forwarding. Unsupported
peer-key/rekey placeholders from V1 have been removed.

Zod validates strict envelopes and control payloads before dispatch. Unknown
properties, invalid JSON, invalid versions, non-object payloads and plaintext
sync are rejected without echoing input. Sequences/cursors are nonnegative safe
integers. Push endpoints must be HTTPS; this syntactic check is not an SSRF
guarantee. Connection, message, join and participant limits still apply.

## Invitation API

Invitation possession is authorization; no additional participant confirmation
is required. Use HTTPS outside loopback development.

1. The authorized client fetches `/health` for `serverTime` and creates an
   invitation expiring ten minutes after that time.
2. It generates a random 256-bit invitation ID and a separate random 256-bit
   invitation key. The encrypted `invite` box contains room/course IDs, epoch,
   room root secret, relay join credential, expiry and initial usage counter.
3. `POST /invites` accepts `{ roomId, deviceId, ticket, inviteId, box, expiresAt }`.
   The ticket must belong to a currently joined session. The relay stores only
   the encrypted package and expiry in RAM.
4. The shared link/QR uses `#/?v=2&invite=<id>&key=<key>`. The fragment works with
   both root BrowserRouter deployments and subpath HashRouter deployments.
   It is removed from browser history immediately after capture. No decryption
   key is submitted to the relay or included in HTTP queries.
5. `POST /invites/redeem` accepts only the invitation ID and returns the box and
   server time. Consumption is atomic: at most one concurrent request succeeds.
   At the exact expiration boundary the invitation is invalid.
6. The new device decrypts and validates the package, stores its key locally,
   then joins and requests an encrypted snapshot from an online participant.

Aborted redemption still consumes the link; generate another invitation.
Expired/redeemed packages are deleted. Relay restart loses outstanding
invitations. Limits: 4 KiB box, 8 KiB HTTP body, 40 outstanding invitations per
room and 10,000 globally, with event rate limiting. Responses are not cached.

This bearer-link workflow deliberately does not protect against a stolen link
during its validity window or enforce expiry against a malicious relay.

## Queues, replay protection and push

The relay routes opaque boxes using IDs, queues deltas for known devices and
retains ciphertext in RAM for the configured retention period (24 hours by
default). Queues, subscriptions and invitations are not persisted. Devices
recreate rooms after relay restart using their locally retained relay
credential; a new snapshot repairs gaps after queue loss.

Clients authenticate boxes before any ingestion, import or application.
Persistent replay keys are `[roomId, epoch, purpose, deviceId, messageId]`;
recording successful processing and applying sync mutations share a database
transaction. Duplicate delivery has no second effect. Invalid messages stop
the connection with an explicit sync error and are not ACKed. Delayed valid
offline messages remain eligible for the existing conflict rules.

For offline recipients, the relay forwards the sender's encrypted `push` box
inside ordinary Web Push: `{ version: 2, roomId, box? }`. It never constructs
notification text from sync data. The receiving service worker loads the local
key and decrypts without requiring an open app tab. Missing keys or invalid
boxes produce only a generic notice; invalid boxes are diagnosed without
sensitive content. Push replay state is separate from sync replay state.
Push boxes larger than 2,800 bytes produce an explicit sender warning and a
generic push, without truncating or dropping the underlying sync.

Web Push/VAPID adds transport protection but is not the E2E layer. Notification
permission and platform support are still required; iOS/iPadOS requires an
installed Home Screen PWA. Detailed notifications may appear on lock screens.

## Deployment and privacy boundaries

Reverse proxies must forward `/relay` WebSockets, `/push/*`, `/health` and
`POST/OPTIONS /invites` and `/invites/redeem` to the relay, without body logging
or caching invitations. The default WebSocket limit is 180,224 bytes (176 KiB)
to accommodate encryption/base64 overhead over the previous 128 KiB limit.
Clients explicitly reject oversized encrypted messages.

Only endpoints store plaintext course content and E2E keys. IndexedDB is not
encrypted at rest; protect browser profiles and the frontend origin. Course
backups do not include sharing secrets. Routing IDs, timing, message lengths,
IP addresses and push endpoints remain visible to infrastructure. E2E does not
protect against compromised clients or modified frontend delivery.
