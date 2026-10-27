# Three runtime surfaces

Horoi uses three separate runtime surfaces. They share application source and the Rust verifier build, but each has a distinct purpose and configuration.

| Surface | Compose | Network and data | Purpose |
| --- | --- | --- | --- |
| Judge | `docker-compose.yml` | `horoi-judge` project; backend on an internal network; frontend also on the loopback-published edge bridge; its own SQLite volume | Zero-credential local synthetic HCP1 walkthrough at `http://localhost:3000/demo`. Demo mode is read-only for public-chain claim creation and action ranges. |
| Public live | `docker-compose.public.yml` service `backend-live` | `horoi-public_live-private` plus egress; separate `live_data` volume | Testnet API for claim creation, snapshots, and proof verification. It is not the Judge backend. |
| Public demo | `docker-compose.public.yml` service `backend-demo` | `horoi-public_demo-private`, with no egress; project-scoped `horoi_data` volume | Synthetic HCP1 Judge fixture served by the public frontend's `/demo` proxy route. |

The public frontend joins both private networks and the edge bridge. Next.js sends `/api/v1/demo/*` to `backend-demo` before the generic `/api/*` rewrite sends other API paths to `backend-live`. Only the frontend is published, on loopback port 3001. The live service can reach its configured RPC endpoint through the egress network; the demo service has no route to public RPC. Public Compose trusts `X-Horoi-Client-IP` only because the configured HTTPS proxy must overwrite that header with the connection peer address. Judge Compose does not trust a proxy header.

The Compose project name scopes volumes. The public demo's existing volume remains `horoi-public_horoi_data`; the live backend gets a separate `horoi-public_live_data`. Do not add an explicit volume name: alternate project names are used for isolated acceptance and must not attach to the public data.

## Resource and admission bounds

Crypto routes have a shared budget of 48 units per minute, an 8-unit per-client budget when a trusted valid client IP is available, and at most two concurrent demo verifier operations. Submission costs two units. The public action-range endpoint permits ranges of at most 16 blocks, with per-client 120 requests/minute and global 600 requests/minute caps. Snapshot creation permits one admitted scan per client and four globally per 15-minute window; malformed requests and invalid AssetIds are rejected before consuming this allowance.

A complete snapshot derivation is admitted one at a time per backend process. It has a 12-minute total deadline including network preflight, at most 80,000 JSON-RPC requests per 15-minute budget window, 16 concurrent RPC requests, a 10-second request timeout, and up to three attempts per request. Each requested action range remains bounded to 16 blocks. The native verifier queue admits at most eight pending requests; each active operation is limited to 120 seconds. Snapshot cancellation is propagated through RPC and queued or active native verification. The API cache holds at most four completed snapshots and is process-local.

Live claim creation, proof verification, claim submission, and action-range requests also share a 14-minute route deadline that includes queued native verifier work. Client disconnects and deadline expiry cancel queued or active native work and RPC work before another stage can begin. This leaves margin below the Next.js 15-minute proxy timeout.

These are load and time bounds, not a throughput guarantee. Cold history scans may take many minutes. A full browser action feed can continue after creation and is subject to the action-range request limits. The browser and API can report a timeout or unavailable snapshot if the RPC provider is slow or a deadline is reached. No fixed maximum chain height is imposed.

## Build and run

Run the local Judge surface:

```sh
docker compose up --build
```

Run the public stack with the exact source revision encoded in image tags and labels:

```sh
export HOROI_SOURCE_SHA="$(git rev-parse HEAD)"
docker compose -f docker-compose.public.yml config --quiet
docker compose -f docker-compose.public.yml up --build -d
```

This starts `backend-live`, `backend-demo`, and `frontend-public` under the `horoi-public` project. The frontend binds to `127.0.0.1:3001`; point the existing HTTPS proxy at `frontend-public:3000` on `horoi-public_edge`. See [DEPLOYMENT.md](DEPLOYMENT.md) for the proxy procedure and the deployment evidence record.

The Judge fixture and public-demo `/demo` route remain synthetic. Historical public QEDIT testnet proof acceptance is recorded separately in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md); it does not establish a new browser-generated proof or cold-scan acceptance for a later deployment.

## Current release acceptance (2026-10-27)

Diagnostic source `92710678a2efad1b27552e9345c41036a604ed3f` is deployed, and `backend-live`, `backend-demo`, and `frontend-public` are healthy. Both backend images use image ID `sha256:f6bd059c7632c796c1f7d0c44f9bb6597241c9303769cb4859899c479d434c18`; `frontend-public` uses image ID `sha256:82df14adc68f4019f897784b7b0320712889d0ce76d0a7b4a982300b38d177a2`. The root application routes to `backend-live`; `/demo` routes to the isolated synthetic backend. The diagnostic source adds safe failure traces only; it does not change snapshot, RPC retry, or proof semantics. See [DEPLOYMENT.md](DEPLOYMENT.md) for the measured acceptance record.

| Gate | Current evidence | Status |
| --- | --- | --- |
| Public-chain snapshot integration | Canonical QEDIT testnet genesis and NU7 were confirmed; a block 1 claim and action range succeeded. This is not holder eligibility. | Verified |
| Synthetic Judge flow | Public `/demo` valid, tampered, and two independent replay walkthroughs passed. | Verified |
| Fresh browser proof from an eligible live note | No new real-note proof was generated or submitted on this release. | Unverified |
| Full cold-scan latency | One diagnostic request was canceled at 30,002 ms during snapshot scanning; it did not complete. No benchmark was run. | Unmeasured |

The local Judge passed `docker compose up --build` from a fresh public clone of default branch `feat/vercel-fullstack` at diagnostic source `92710678a2efad1b27552e9345c41036a604ed3f`. Both containers became healthy, the proxied health endpoint returned HTTP 200 with `zebra-regtest`, and browser valid, tamper, and replay scenarios passed. Its task-created Compose resources were removed after the run. The deployed-source and local-clone results establish the three-surface wiring and fixture behavior; they do not close the fresh live-proof gate.
