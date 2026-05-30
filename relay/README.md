# DigiKladde Relay (V1)

Relay server for encrypted peer signaling and sync message forwarding.

## Scope

This service is transport-only:

- Validates room join (`roomId` + `joinSecret`)
- Issues short-lived tickets
- Forwards peer events in a room
- Does not decrypt E2E payloads

## Run locally

```bash
cd relay
npm install
npm run dev
```

Relay defaults:

- HTTP health: `http://127.0.0.1:8080/health`
- WebSocket: `ws://127.0.0.1:8080/relay`

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

## Docker

Build image:

```bash
cd relay
docker build -t digikladde-relay:local .
```

Run container:

```bash
docker run --rm -p 8080:8080 digikladde-relay:local
```

### GHCR publish

The repository contains the workflow `.github/workflows/publish-relay-image.yml`.

- On push to `main` (with changes under `relay/**`) it publishes to GHCR.
- On version tags (`v*`) it publishes a tagged image.
- On pull requests it only validates that the Docker image builds.

Image name:

```text
ghcr.io/<github-org-or-user>/digikladde-relay
```

Pull example:

```bash
docker pull ghcr.io/<github-org-or-user>/digikladde-relay:latest
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

## Nginx routing note

For production on `digikladde.aircursion.de`, route websocket traffic from `/relay` to this container and keep TLS termination at Nginx.
