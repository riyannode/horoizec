# Docker Deployment

Horoi has two Docker Compose modes that use the same locked Bun/Next and Rust build configuration:

| Mode | Command | Access |
| --- | --- | --- |
| Local judge | `docker compose up --build` | Frontend at `http://localhost:3000`; zero credentials and no public RPC. |
| Public demo | `docker compose --project-name horoi-public -f docker-compose.yml -f docker-compose.public.yml --profile public up --build -d backend frontend-public` | Frontend bound to `127.0.0.1:3001` for an HTTPS reverse proxy. |

The public deployment adds `docker-compose.public.yml`, which enables `HOROI_TRUST_PROXY_CLIENT_IP`. Use it only behind a proxy that overwrites `X-Horoi-Client-IP` with the actual connection peer address. The default judge Compose keeps proxy trust disabled. `X-Forwarded-For` is never used for rate-limit identity. The default judge build needs no `.env`; its image tag and `org.opencontainers.image.revision` label use `unknown`. For a release build, set `HOROI_SOURCE_SHA` to the checked-out commit so both image tags and revision labels identify that exact source commit.

The public stack is project-isolated as `horoi-public`: its private network, persistent SQLite volume, and containers are separate from `horoi-judge` and other Compose projects. Only the frontend's loopback port is published. The backend, verifier process, and database have no host ports. Both modes use the pinned HCP1 fixture labeled LOCAL SYNTHETIC TEST FIXTURE and do not connect to QEDIT RPC or perform cold snapshot creation.

## Authorized VPS procedure

Use only the authorized VPS and an existing HTTPS reverse proxy. Confirm the intended hostname, available loopback port `3001`, disk/memory capacity, Docker Compose availability, reverse-proxy configuration, and current running projects before deployment. Do not replace the proxy, publish port `8787`, mount another project's data, or alter unrelated services.

Build and start the isolated project from the exact checked-out source revision:

```bash
export HOROI_SOURCE_SHA="$(git rev-parse HEAD)"
docker compose --project-name horoi-public -f docker-compose.yml -f docker-compose.public.yml --profile public up --build -d backend frontend-public
docker compose --project-name horoi-public -f docker-compose.yml -f docker-compose.public.yml --profile public ps
docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' horoi/horoi-backend:"$HOROI_SOURCE_SHA" horoi/horoi-frontend:"$HOROI_SOURCE_SHA"
curl --fail http://127.0.0.1:3001/demo
```

Configure the existing proxy's Horoi hostname to forward HTTPS traffic to the loopback frontend. In that site block, set `X-Horoi-Client-IP` from the proxy's connection peer; strip/replace a caller-supplied value. Never expose backend port 8787. Validate the complete proxy config before a graceful reload, then check the public URL without authentication, `/demo`, proxied API routing, both container health checks, and the unrelated site's health. Record the deployed Git commit and image digests after the public response is live.

Stop or reset only the public project with `docker compose --project-name horoi-public -f docker-compose.yml -f docker-compose.public.yml --profile public down` (preserves its volume) or append `-v` when an authorized full reset is intended. Do not use Docker prune commands.

## Current HTTPS route status

The inspected VPS uses the existing `unmet-web` Caddy container for ports 80 and 443. Its active Caddyfile has `admin off`, is baked into the UNMET image, and is not mounted from the host. Caddy validation succeeds, but there is no enabled admin endpoint for a graceful reload; applying an added hostname would require replacing the UNMET web container. That would interrupt an unrelated production service, so no Caddy or UNMET change was made. The Cloudflare zone record list contained only the apex and `www`; `horoi.unmetxyz.my.id` had no DNS record, and none was created. No public Horoi HTTPS URL is active until an additive route can be installed without recreating the UNMET proxy and DNS is configured.

## Current release deployment (2026-10-27)

The VPS `horoi-public` Compose project runs the release from Draft PR #1 on `linux/amd64`; the PR records the exact deployed source SHA and image IDs. Both containers are healthy. Only the frontend is published, bound to `127.0.0.1:3001`; backend `8787` has no host binding. The existing `horoi-public_horoi_data` SQLite volume is preserved.

VPS-local unauthenticated checks returned HTTP 200 for `/`, `/claims`, `/create`, `/verify`, `/demo`, `/api/v1/health`, and `/api/v1/demo/fixture`. The native verifier returned `valid: true` for the genuine fixture and `INVALID_PROOF` for tampered proof, altered AssetId, and altered snapshot height. Two replay walkthroughs each returned first-submission acceptance followed by `NULLIFIER_USED`; the persistent nullifier row count remained unchanged across repeat runs. Three simultaneous verifier requests produced two HTTP 200 responses and one HTTP 429. Nine requests carrying different `X-Forwarded-For` values reached validation, while a single trusted proxy identity received HTTP 429 with `Retry-After: 60` on its ninth request. The backend image environment and runtime logs had no private-key, spending-key, seed, mnemonic, or witness pattern matches.

These checks were made from the VPS over loopback, not from an external browser. UNMET HTTPS root and `/health` both remained HTTP 200 with valid TLS after the Horoi update. No Horoi HTTPS hostname was activated: the existing UNMET Caddy configuration has no safe reload path, and changing it would require recreating the unrelated UNMET web container. Horoi remains **loopback-only**, so no public URL is available.

The public demo is a read-only judge fixture: new claim creation and public action-range fetching are disabled; HCP1 verification has global, trusted per-client, and concurrent-operation limits; the public API never receives witness or spending-key data. Normal claim submissions use persistent SQLite replay state. The `/demo` replay walkthrough uses a fresh request-local SQLite database and does not modify the persistent database. No paid service, Vercel deployment, production key, or public-chain scan is configured.
