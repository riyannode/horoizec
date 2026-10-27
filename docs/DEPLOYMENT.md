# Docker Deployment

Horoi has two Docker Compose modes that use the same locked Bun/Next and Rust build configuration:

| Mode | Command | Access |
| --- | --- | --- |
| Local judge | `docker compose up --build` | Frontend at `http://localhost:3000`; zero credentials and no public RPC. |
| Public demo | `docker compose --project-name horoi-public --profile public up --build -d backend frontend-public` | Frontend bound to `127.0.0.1:3001` for an HTTPS reverse proxy. |

As of 2026-10-27, the VPS `horoi-public` containers are stopped at user direction. Their project-scoped SQLite volume is preserved. No public hostname or HTTPS route is configured.

The public stack is project-isolated as `horoi-public`: its private network, persistent SQLite volume, and containers are separate from `horoi-judge` and other Compose projects. Only the frontend's loopback port is published. The backend, verifier process, and database have no host ports. Both modes use the pinned public HCP1 fixture and do not connect to QEDIT RPC or perform cold snapshot creation.

## Authorized VPS procedure

Use only the authorized VPS and an existing HTTPS reverse proxy. Confirm the intended hostname, available loopback port `3001`, disk/memory capacity, Docker Compose availability, reverse-proxy configuration, and current running projects before deployment. Do not replace the proxy, publish port `8787`, mount another project's data, or alter unrelated services.

Build and start the isolated project:

```bash
docker compose --project-name horoi-public --profile public up --build -d backend frontend-public
docker compose --project-name horoi-public --profile public ps
curl --fail http://127.0.0.1:3001/demo
```

Configure the existing proxy's Horoi hostname to forward HTTPS traffic to `127.0.0.1:3001`. Then verify the public URL without authentication, `/demo`, the proxied `/api/v1/demo/fixture` path, and both container health checks. Record the deployed Git commit and image digests after the public response is live. This repository does not contain a hostname or public URL until one is assigned and verified.

Stop or reset only the public project with `docker compose --project-name horoi-public --profile public down` (preserves its volume) or append `-v` when an authorized full reset is intended. Do not use Docker prune commands.

The public demo is a read-only judge fixture: new claim creation and public action-range fetching are disabled; HCP1 verification is rate-limited; the public API never receives witness or spending-key data. The persistent SQLite volume records replay acceptance. No paid service, Vercel deployment, production key, or public-chain scan is configured.
