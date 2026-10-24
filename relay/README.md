# DigiKladde Relay (V1)

Relay server for encrypted peer signaling and sync message forwarding.

## Scope

This service is transport-only:

- Validates room join (`roomId` + `joinSecret`)
- Issues short-lived tickets
- Forwards peer events in a room
- Does not decrypt E2E payloads

Join payloads must be objects with nonempty string fields `roomId`, `deviceId`
and `joinSecret`. Strings are trimmed before use. Invalid join data receives an
`invalid_event` error without changing room membership or closing the connection,
so clients can retry on the same socket. Existing rate limits still apply.
Unexpected synchronous message-processing errors are logged without message
contents or credentials and close only the affected connection with code 1011.

## Run locally

Install workspace dependencies from the repository root:

```bash
npm ci
npm run -w relay dev
```

Relay defaults:

- HTTP health: `http://127.0.0.1:8080/health`
- WebSocket: `ws://127.0.0.1:8080/relay`

## Unit tests

From the repository root:

```bash
npm run test:relay
```

The node:test suite covers queue delivery/ACKs, deduplication, retention, session
isolation, rate limits, buffer limits and configuration. Time boundaries use
explicit timestamps rather than real waiting. Configuration cases run in isolated
processes, independent of the caller's relay environment variables.

Server regression tests start an isolated loopback relay process. They cover
malformed joins, retries on the same socket, preserved sessions, forwarding and
connection-local exception handling, including continued health availability.

`npm run test:e2e` additionally starts a real local relay and tests course sharing
and flight recording between two browser contexts. See
[Development](../DEVELOPMENT.md#automatisierte-tests) for setup and diagnostics.

## Smoke test

Start relay first, then:

```bash
cd relay
npm run smoke
```

## Build

```bash
cd relay
npm run build
npm start
```

## Lint

From repository root:

```bash
npm run lint:relay
```

## Docker

Build image:

```bash
npm run build:relay
docker build -t digikladde-relay:local ./relay
```

Run container:

```bash
docker run --rm -p 8080:8080 digikladde-relay:local
```

### GHCR publish

The integrated workflow `.github/workflows/ci.yml` has separate app build, relay
build, publishing, deployment, E2E and cleanup jobs.

The relay job also archives a `linux/amd64` Docker image for the E2E runner,
using the same Dockerfile and build cache as the multiarch publish. E2E loads
this artifact rather than rebuilding the relay or pulling a mutable GHCR tag.
Both GHCR publishing and GitHub Pages deployment require successful E2E tests.
Failed, cancelled or skipped build/E2E jobs prevent either publication.

- Only runs on `main` publish to GHCR, with both the `main` and `latest` tags
  pointing to the same image.
- PRs (including forks) and other branches pass images to E2E as artifacts,
  without registry credentials. Local image tags derive from the PR number
  (`pr-123`) or sanitized branch name.
- Manual runs follow the same rules; there is no `docker-push` switch.
- After publishing, cleanup retains only the current image tagged `main` and
  `latest` and its referenced platform/attestation manifests. Old tags and
  unreferenced versions are removed.
- PR closure does not trigger cleanup because PRs do not publish GHCR images.
  Cleanup only runs after successful publishing.

The repository needs admin access to this GHCR package under **Manage Actions
access** for deletion using `GITHUB_TOKEN`. Registry authorization errors fail
the cleanup explicitly. See [Development](../DEVELOPMENT.md#ghcr-cleanup).

Image name:

```text
ghcr.io/<github-org-or-user>/digikladde-relay
```

Pull example:

```bash
docker pull ghcr.io/<github-org-or-user>/digikladde-relay:main
```

## Environment variables

- `RELAY_HOST` (default `0.0.0.0`)
- `RELAY_PORT` (default `8080`)
- `RELAY_WS_PATH` (default `/relay`)
- `RELAY_MAX_PAYLOAD_BYTES` (default `131072`)
- `RELAY_MAX_CONNECTIONS_PER_IP` (default `40`)
- `RELAY_MAX_EVENTS_PER_MINUTE_PER_IP` (default `1200`)
- `RELAY_MAX_JOIN_PER_MINUTE_PER_ROOM` (default `100`)
- `RELAY_MAX_PARTICIPANTS_PER_ROOM` (default `40`)
- `RELAY_HEARTBEAT_INTERVAL_MS` (default `30000`)
- `RELAY_IDLE_TIMEOUT_MS` (default `120000`)
- `RELAY_TICKET_TTL_MS` (default `900000`)
- `RELAY_MESSAGE_BUFFER_LIMIT_PER_ROOM` (default `100`)
- `RELAY_QUEUE_RETENTION_MS` (default `86400000`)
- `RELAY_WEB_PUSH_PUBLIC_KEY` (optional; enables Web Push only when all Web Push vars are set)
- `RELAY_WEB_PUSH_PRIVATE_KEY` (optional)
- `RELAY_WEB_PUSH_SUBJECT` (optional; for example `mailto:admin@example.com`)

The catch-up queue and Web Push subscriptions are in-memory. They help devices recover from mobile standby gaps, but they do not survive relay restarts. Web Push is a notification nudge only; clients still reconnect to the relay and request queued deltas before applying updates.

Web Push requires HTTPS, notification permission, and a service worker. On iOS/iPadOS it is available for installed Home Screen web apps, not ordinary Safari tabs.

## Nginx routing note

For production on `digikladde.aircursion.de`, route websocket traffic from `/relay` to this container and keep TLS termination at Nginx.
