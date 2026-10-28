# Docker Deployment

Horoi has three runtime surfaces built from the same locked Bun/Next and Rust configuration. Run the Judge with the root Compose file; run the standalone public live and demo services with `docker-compose.public.yml`. See [THREE_SURFACES.md](THREE_SURFACES.md) for routing and resource bounds.

| Mode | Command | Access |
| --- | --- | --- |
| Local judge | `docker compose up --build` | Frontend at `http://localhost:3000`; zero credentials and no public RPC. |
| Public live and demo | `docker compose -f docker-compose.public.yml up --build -d` | Live API and synthetic demo behind frontend at `127.0.0.1:3001`. |

The public Compose configuration enables `HOROI_TRUST_PROXY_CLIENT_IP`. Use it only behind a proxy that overwrites `X-Horoi-Client-IP` with the actual connection peer address. The default judge Compose keeps proxy trust disabled. `X-Forwarded-For` is never used for rate-limit identity. The default judge build needs no `.env`; its image tag and `org.opencontainers.image.revision` label use `unknown`. For a release build, set `HOROI_SOURCE_SHA` to the checked-out commit so both image tags and revision labels identify that exact source commit.

The public stack is project-isolated as `horoi-public`: live and demo backends have separate internal networks and SQLite volumes. The live backend alone has egress to its configured testnet RPC. The demo backend has no egress. The frontend joins both networks and the edge bridge; only its loopback port is published. The `/demo` route uses the synthetic HCP1 fixture; other API routes reach the live backend. The Judge remains a separate, read-only synthetic environment.

## Authorized VPS procedure

Use only the authorized VPS and an existing HTTPS reverse proxy. Confirm the intended hostname, available loopback port `3001`, disk/memory capacity, Docker Compose availability, reverse-proxy configuration, and current running projects before deployment. Do not replace the proxy, publish port `8787`, mount another project's data, or alter unrelated services.

Build and start the isolated project from the exact checked-out source revision:

```bash
export HOROI_SOURCE_SHA="$(git rev-parse HEAD)"
docker compose -f docker-compose.public.yml up --build -d
docker compose -f docker-compose.public.yml ps
docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' horoi/horoi-backend:"$HOROI_SOURCE_SHA" horoi/horoi-frontend-public:"$HOROI_SOURCE_SHA"
curl --fail http://127.0.0.1:3001/demo
```

Configure the existing proxy's Horoi hostname to forward HTTPS traffic to the loopback frontend. In that site block, set `X-Horoi-Client-IP` from the proxy's connection peer; strip/replace a caller-supplied value. Never expose backend port 8787. Validate the complete proxy config before a graceful reload, then check the public URL without authentication, `/demo`, proxied API routing, both container health checks, and the unrelated site's health. Record the deployed Git commit and image digests after the public response is live.

Stop or reset only the public project with `docker compose -f docker-compose.public.yml down` (preserves its volumes) or append `-v` when an authorized full reset is intended. Do not use Docker prune commands.

## Earlier three-surface release and acceptance (2026-10-27)

The deployed application source is `d4569b424d0c16dab41614fda3d1f2c82d78279d`, pushed to the existing `feat/vercel-fullstack` branch. All three public Compose services are healthy and carry that source revision label:

| Service | Image digest | Published port |
| --- | --- | --- |
| `backend-live` (`horoi/horoi-backend:d4569b424d0c16dab41614fda3d1f2c82d78279d`) | `sha256:e77308498b15d1217c7b6fefa4ae16f2dbfeffab92ff0c36362da42ce1f5388a` | None |
| `backend-demo` (`horoi/horoi-backend:d4569b424d0c16dab41614fda3d1f2c82d78279d`) | `sha256:e77308498b15d1217c7b6fefa4ae16f2dbfeffab92ff0c36362da42ce1f5388a` | None |
| `frontend-public` (`horoi/horoi-frontend-public:d4569b424d0c16dab41614fda3d1f2c82d78279d`) | `sha256:3055962377126f5f717ea693650295829bf3258d2c9b83557376e757eb362bdf` | `127.0.0.1:3001` |

External HTTPS checks with trusted TLS returned HTTP 200 for `/`, `/claims`, `/create`, `/verify`, `/demo`, and `/api/v1/health`; the live health response identified `zsa-testnet`. The real create form was present on `/create`, and the integration claim detail page exposed its local proving interface. Live API validation against canonical QEDIT public ZSA testnet state confirmed genesis `f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756` and active NU7. A one-block snapshot claim was created with HTTP 201 in 2,115 ms, and `/api/v1/snapshots/1/actions?start=1&end=1` returned HTTP 200. Its commitment root matched the canonical public-chain state.

The claim is named “Canonical public testnet snapshot check” and is explicitly described as an integration check. Its ID is `401cdcfbe89267bd9daa18e668349986388a5a1a44b77a7c3c8bb6cb6778d44d`; its commitment root is `f35a6220d63e4af95d8e68de42dc7ce3c2d54d5fafd7b6f70c220df271a95e1d`. This verifies public-chain snapshot integration, not holder eligibility. A malformed HCP1 bundle against the real claim returned `valid: false` through the native Rust verifier. The fixture claim was absent from the live API (`CLAIM_NOT_FOUND`).

The public browser rendered the valid, tampered, and replay scenarios at `/demo`; valid verification returned true, tampering returned `INVALID_PROOF`, and two independent replay walkthroughs each returned `NULLIFIER_USED`. Browser network inspection saw only public claim reads and demo request fields (`scenario` or `fixtureId`); no spending key was entered. Console errors and warnings were absent. A fresh real-note proof was not generated or submitted, and a full cold scan was not benchmarked. The historical QEDIT proof record below remains separate.

Live SQLite contains the one `zsa-testnet` integration claim and no nullifiers. The demo volume contains its existing `zebra-regtest` fixture claim and one pre-existing nullifier; repeated replay walkthroughs left both database counts unchanged. The Caddyfile remained byte-identical at SHA-256 `f454b12506d1d5cfe2bd84772d067333e83f061d47fa526d1e7e7784af3e1c9d`; the existing frontend-public edge attachment was retained, and neither Caddy nor UNMET was recreated. UNMET `/`, `/health`, `/ready`, `/live`, and `/v1/demands` returned HTTP 200 before and after; container, environment, image, and mount fingerprints were unchanged, and its payment volume was untouched. The legacy Horoi fixture backend was stopped and retained for rollback.

The local Judge was also built and run from a fresh GitHub clone of this source revision. `docker compose up --build` completed with two healthy containers and no `.env`, host artifacts, keys, or RPC service. Valid, tampered, and two replay walkthroughs passed. An isolated project namespace was used to preserve pre-existing local resources; project reset and SQLite persistence across backend restart were verified in isolated local projects. Full acceptance records are in the task evidence bundle; this docs update does not change deployed application code.

## Earlier diagnostic deployment (2026-10-27)

The safe diagnostic source `92710678a2efad1b27552e9345c41036a604ed3f` is deployed from the existing `feat/vercel-fullstack` branch. The backend/frontend image labels match this commit:

| Service | Image ID | Published port |
| --- | --- | --- |
| `backend-live` and `backend-demo` | `sha256:f6bd059c7632c796c1f7d0c44f9bb6597241c9303769cb4859899c479d434c18` | None |
| `frontend-public` | `sha256:82df14adc68f4019f897784b7b0320712889d0ce76d0a7b4a982300b38d177a2` | `127.0.0.1:3001` |

The backend change adds failure-only structured diagnostics for route stage, RPC method/attempt/duration, safe failure category, snapshot height, and abort state. RPC retry counts/timeouts, the route and snapshot deadlines, canonical genesis and reorg checks, root derivation, HCP1 semantics, and API error codes are unchanged. The change does not fix the 30-second cancellation.

After deployment, public `/api/v1/health`, `/create`, `/claims`, and `/demo` returned HTTP 200. The live and demo SQLite databases both passed `PRAGMA integrity_check`; live remained at one claim and zero nullifiers, and demo at one claim and one nullifier. The public synthetic demo returned valid fixture `true`, tampered fixture `false` / `INVALID_PROOF`, and replay `NULLIFIER_USED`. The five configured UNMET endpoints returned HTTP 200, the UNMET containers remained healthy, and the Caddyfile SHA-256 remained `f454b12506d1d5cfe2bd84772d067333e83f061d47fa526d1e7e7784af3e1c9d`; neither UNMET nor Caddy was recreated.

One browser claim attempt at snapshot 7596 returned backend HTTP 503 after 30,002 ms. Instrumentation recorded `snapshot_scan`, `getblockhash` at block 384, then `request_closed` / `parent_abort`. Next.js 16.4.0 logged `ECONNRESET`; its deployed `experimental.proxyTimeout` was 900,000 ms. The Horoi Caddy site has no short proxy timeout. The exact owner of the upstream 30-second connection close remains unproven. The later async scan attempt is recorded separately below and in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).

## Async claim-job deployment checkpoint (2026-10-27)

The PR head and deployed-source checkpoint was `ce36f60ce5f6dc761bf7b78b849952d172a2a343`. A public `GET /api/v1/health` returned HTTP 200 with `network: zsa-testnet`. The exact Docker image IDs and current container health were not independently queried during this follow-up; the SSH key available in WSL was rejected by the VPS, so the earlier `9271067` image IDs above do not identify this source.

The ChatGPT in-app browser submitted one real public QEDIT claim job at snapshot 8457. `POST /api/v1/claims/jobs` returned HTTP 202 and status polling returned HTTP 200, but the job failed with `SNAPSHOT_UNAVAILABLE` before inserting a claim. It was observed terminal about 11m24s after submission. The public job status exposed only `snapshot_resolution`; the backend log with the failing RPC method, block, and failure category could not be retrieved. Bounded post-failure `getblockhash`, `getblock`, and `z_gettreestate` probes returned HTTP 200. These probes do not establish a successful full scan.

The working-tree follow-up adds bounded, process-memory checkpoints for complete 16-block scan ranges, with canonical end-hash validation, per-job range progress, and unchanged final snapshot/reorg checks. This code was not deployed at this checkpoint. Checkpoints and job state are lost on a backend restart. No source deployment, Caddy reload, or UNMET service change was performed during this follow-up.

The working tree passed backend typecheck/build and 20 focused tests (149 assertions). An isolated `horoi-resume-test` Docker Judge build produced healthy backend and frontend containers; `/api/v1/health` and `/demo` returned HTTP 200, and ChatGPT's in-app browser observed valid-fixture acceptance, tamper rejection (`INVALID_PROOF`), and replay rejection (`NULLIFIER_USED`). The hosted `/demo` passed the same three synthetic scenarios in that browser. The project-specific containers, volume, and networks were removed after validation. This does not validate the checkpoint change against the public RPC and does not change the deployed source identity.

## Historical pre-correction HTTPS acceptance (2026-10-27)

This record describes the earlier single-backend public deployment. The current source uses separate `backend-live` and `backend-demo` services as described above; this historical acceptance does not identify the corrected release or prove its browser-wallet flow.

At the time of the earlier deployment, the public Docker demo was available at [https://horoi.kima.my.id](https://horoi.kima.my.id), with its fixture walkthrough at [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo). `horoi.kima.my.id` resolved to `43.156.68.254`. From an external Windows client, both URLs returned HTTP 200 with `curl.exe` TLS verification result 0; an unauthenticated browser loaded `/demo` and rendered the valid, tampered-proof, and replay results.

Caddy was running in `unmet-web-1` (image `unmet-web:af2c4a4d33a438364cd67e1f5f1576253ae3b4b1`). Its original Caddyfile was backed up before the controlled web-only recreation. The Caddyfile was mounted read-only at `/etc/caddy/Caddyfile` from `/opt/horoi-caddy-d6cc100/Caddyfile`, SHA-256 `f454b12506d1d5cfe2bd84772d067333e83f061d47fa526d1e7e7784af3e1c9d`. The original UNMET site blocks were preserved verbatim. The additive `horoi.kima.my.id` site routed to `frontend-public:3000` on `horoi-public_edge` and overwrote `X-Horoi-Client-IP` with Caddy's connection peer address.

The recreated Caddy web container is healthy and retains its prior image, ports, environment, security settings, `172.30.80.2` address on `unmet_application`, and the `unmet_caddy_config` / `unmet_caddy_data` volumes. Its additional Horoi edge address is `172.18.0.3`. The UNMET API container ID remains `858c5caf1fd607c75c5ee47e2c3d7f775c7e7a152e47715fd609fc84755c6c90`; the `unmet_payment_data`, `unmet_caddy_data`, and `unmet_caddy_config` volume identities and mountpoints are unchanged. After recreation, UNMET `/`, `/health`, `/ready`, `/live`, and `/v1/demands` all returned HTTP 200.

## Historical pre-correction release identity and acceptance (2026-10-27)

The following image and source identities belong to the earlier single-backend public deployment, before the three-surface configuration. Use the final release record supplied for the corrected deployment for current image identities and acceptance.

The earlier public Docker project was `horoi-public`. The deployed application source revision at that time was `d6cc100968aa9975930d71213439d2b3c9c5dd01` (`feat/vercel-fullstack`, Draft PR #1). Both legacy containers were healthy:

| Service | Image | Image digest | Host binding |
| --- | --- | --- | --- |
| Frontend | `horoi/horoi-frontend:d6cc100968aa9975930d71213439d2b3c9c5dd01` | `sha256:7c0f5ad19d334402bd2e76dfa2173b5026bf54a4ae5c8356a869ac27dd6fde25` | `127.0.0.1:3001` |
| Backend | `horoi/horoi-backend:d6cc100968aa9975930d71213439d2b3c9c5dd01` | `sha256:d7b76c5b7d1c18760b7df4e1a3623532cb3f7069e3365165505267e56b6dde5e` | None (`8787/tcp` stays private) |

The Caddy container reached the frontend through `horoi-public_edge`. The backend was on the private Horoi application network; no backend or SQLite port was published. The persistent `horoi-public` SQLite volume was unchanged at that release.

External acceptance returned HTTP 200 for `/`, `/demo`, `/api/v1/health`, `/api/v1/demo/fixture`, `/api/v1/claims`, and the fixture claim details route. The public browser showed `HTTP 200 · valid: true · horoi-verifier`; the one-byte-tampered fixture returned `valid: false` and `INVALID_PROOF`. The replay walkthrough returned first-submission acceptance followed by `NULLIFIER_USED`; repeating the walkthrough produced the same result because each request uses a fresh isolated SQLite database. The page labels the fixture `LOCAL SYNTHETIC TEST FIXTURE` and explicitly distinguishes it from public QEDIT testnet evidence.

The hosted Docker demo and the historical public QEDIT testnet proof run are separate evidence. The hosted fixture proves that the deployed Rust/HCP1 verifier accepts the pinned synthetic fixture and rejects the tampered proof; it does not establish a live public-chain scan, Zebra regtest execution, or a newly generated browser wallet proof. No public-chain scan or blockchain transaction runs at startup.


## Earlier interrupted continuation (2026-10-28)

A single live create retry at QEDIT height 8457 succeeded and persisted claim c19b11d72b79fab77b21942e031ae52ac177550a9a19de3a3ecee0fb1a40060e with threshold 1 and canonical roots. The public app remains on deployed source ce36f60; PR source 4a08917 is not deployed.

In ChatGPT's in-app browser, the claim scan fetched public 16-block action ranges through block 4016/8457, with every observed request returning HTTP 200. The test tab was closed when the user interrupted the run. No proof, submission, replay, tamper, or fresh proof-submit privacy result exists. The browser tool now reports local browser use disabled, so this attempt was not resumed. Note eligibility for the circuit is unconfirmed.

A fresh public clone of 4a08917 passed the Docker Judge build and browser valid/tamper/replay scenarios. Its zebra-regtest fixture remains synthetic and separate from the live QEDIT claim. The clone's project-specific containers, volume, network, and directory were removed. No production deployment, Caddy reload, or UNMET service change was made.

## Current deployed release and fresh QEDIT E2E (2026-10-28)

The verified `vps-development` SSH alias targets `root@43.156.68.254`. Source `59ade00c5d075ded514972b97f6da19c60087820` is deployed in the existing `horoi-public` Compose project. No volume reset occurred; `horoi-public_live_data` and `horoi-public_horoi_data` remain separate. All three Horoi containers are healthy:

| Service | Image ID | State |
| --- | --- | --- |
| `frontend-public` | `sha256:cf0e2cb91c929a2cb6ea63c442ea8a9c5c03d753ed59de36ab76cf8a8f51120f` | healthy |
| `backend-live` | `sha256:393e3a047322ab1b944db5c4a6baaae67bc0f306ead3e9121d8eb05abc78a0b3` | healthy |
| `backend-demo` | `sha256:393e3a047322ab1b944db5c4a6baaae67bc0f306ead3e9121d8eb05abc78a0b3` | healthy |

`/`, `/demo`, `/api/v1/health`, the live claim page, and `/api/v1/demo/fixture` returned HTTP 200; health reports `network: zsa-testnet`. Both live and demo SQLite databases passed `PRAGMA integrity_check`. Caddy container `fe88c27251c3520fc9f99c8d90a2ba0e66f6cd8bc79f46260445e74b5e55d88c` and UNMET API container `8694dcb44075d9cea3d35fa375880e8cb6045b883a26e542b635485eb477011b` retained their IDs and healthy status. UNMET `/health`, `/ready`, `/live`, and `/v1/demands` returned HTTP 200. No Caddy or UNMET recreation was performed.

The same deployment completed a fresh browser-local HCP1 flow for the existing public QEDIT claim at snapshot 8457. The proof job returned HTTP 202 and terminal HTTP 200 with `accepted: true`; stateless verification returned HTTP 200/`valid: true`, identical replay returned HTTP 409/`NULLIFIER_USED`, and tampering returned HTTP 200/`valid: false`. The report records the 5,640-byte proof, public roots, WASM identities, timings, scan coverage, and request-field privacy inspection. WSL Docker Engine was unavailable, so the local root Docker Judge was not rerun against 59ade00; the last clean-clone Judge result remains at 4a08917.


Final closeout: a clean-clone Docker Judge at `7ec11fd` passed health, valid, tamper, and repeatable replay checks on 2026-10-28 using an isolated VPS Compose project. Its fixture is synthetic; the earlier Docker limitation above is historical. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).
