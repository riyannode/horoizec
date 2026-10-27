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

## Verified public HTTPS route (2026-10-27)

The public Docker demo is live at [https://horoi.kima.my.id](https://horoi.kima.my.id), with the judge walkthrough at [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo). `horoi.kima.my.id` resolves to `43.156.68.254`. From an external Windows client, both URLs returned HTTP 200 with `curl.exe` TLS verification result 0; an unauthenticated browser loaded `/demo` and rendered the genuine valid, tampered-proof, and replay results.

Caddy runs in `unmet-web-1` (image `unmet-web:af2c4a4d33a438364cd67e1f5f1576253ae3b4b1`). Its original Caddyfile was backed up before the controlled web-only recreation. The active Caddyfile is now a persistent read-only bind mount at `/etc/caddy/Caddyfile` from `/opt/horoi-caddy-d6cc100/Caddyfile`, SHA-256 `f454b12506d1d5cfe2bd84772d067333e83f061d47fa526d1e7e7784af3e1c9d`. The original UNMET site blocks were preserved verbatim. The additive `horoi.kima.my.id` site routes to `frontend-public:3000` on `horoi-public_edge` and overwrites `X-Horoi-Client-IP` with Caddy's connection peer address.

The recreated Caddy web container is healthy and retains its prior image, ports, environment, security settings, `172.30.80.2` address on `unmet_application`, and the `unmet_caddy_config` / `unmet_caddy_data` volumes. Its additional Horoi edge address is `172.18.0.3`. The UNMET API container ID remains `858c5caf1fd607c75c5ee47e2c3d7f775c7e7a152e47715fd609fc84755c6c90`; the `unmet_payment_data`, `unmet_caddy_data`, and `unmet_caddy_config` volume identities and mountpoints are unchanged. After recreation, UNMET `/`, `/health`, `/ready`, `/live`, and `/v1/demands` all returned HTTP 200.

## Public release identity and acceptance (2026-10-27)

The public Docker project is `horoi-public`. The deployed application source revision is `d6cc100968aa9975930d71213439d2b3c9c5dd01` (`feat/vercel-fullstack`, Draft PR #1). Both containers are healthy:

| Service | Image | Image digest | Host binding |
| --- | --- | --- | --- |
| Frontend | `horoi/horoi-frontend:d6cc100968aa9975930d71213439d2b3c9c5dd01` | `sha256:7c0f5ad19d334402bd2e76dfa2173b5026bf54a4ae5c8356a869ac27dd6fde25` | `127.0.0.1:3001` |
| Backend | `horoi/horoi-backend:d6cc100968aa9975930d71213439d2b3c9c5dd01` | `sha256:d7b76c5b7d1c18760b7df4e1a3623532cb3f7069e3365165505267e56b6dde5e` | None (`8787/tcp` stays private) |

The Caddy container reaches the frontend through `horoi-public_edge`. The backend remains on the private Horoi application network; no backend or SQLite port is published. The persistent `horoi-public` SQLite volume is unchanged.

External acceptance returned HTTP 200 for `/`, `/demo`, `/api/v1/health`, `/api/v1/demo/fixture`, `/api/v1/claims`, and the fixture claim details route. The public browser showed `HTTP 200 · valid: true · horoi-verifier`; the one-byte-tampered fixture returned `valid: false` and `INVALID_PROOF`. The replay walkthrough returned first-submission acceptance followed by `NULLIFIER_USED`; repeating the walkthrough produced the same result because each request uses a fresh isolated SQLite database. The page labels the fixture `LOCAL SYNTHETIC TEST FIXTURE` and explicitly distinguishes it from public QEDIT testnet evidence.

The hosted Docker demo and the historical public QEDIT testnet proof run are separate evidence. The hosted fixture proves that the deployed Rust/HCP1 verifier accepts the pinned synthetic fixture and rejects the tampered proof; it does not establish a live public-chain scan, Zebra regtest execution, or a newly generated browser wallet proof. No public-chain scan or blockchain transaction runs at startup.
