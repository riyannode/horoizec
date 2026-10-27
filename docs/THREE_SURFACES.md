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

A complete snapshot derivation is admitted one at a time per backend process. It has a 12-minute total deadline including network preflight, at most 80,000 JSON-RPC requests per 15-minute budget window, 16 concurrent RPC requests, a 10-second request timeout, and up to three attempts per request. Each requested action range remains bounded to 16 blocks. Completed snapshot-scan ranges can be resumed from a process-local checkpoint only after the current canonical hash at the range end matches. Checkpoints are capped at one snapshot, 10,000 ranges, and 200,000 nullifiers; they are discarded after success and lost on backend restart. The native verifier queue admits at most eight pending requests; each active operation is limited to 120 seconds. Snapshot cancellation is propagated through RPC and queued or active native verification. The API cache holds at most four completed snapshots and is process-local.

Synchronous live claim creation, proof verification, claim submission, and action-range requests share a 14-minute route deadline that includes queued native verifier work. Client disconnects and deadline expiry cancel queued or active native work and RPC work before another stage can begin. The browser create form instead starts a bounded in-process job through a short 202 response, then polls its status and can explicitly cancel it. That job has a 14-minute deadline, one active snapshot scan per backend process, a 64-entry cap, and in-memory status retained for up to 30 minutes; a backend restart loses the job status and scan checkpoints. Its status reports the last completed scan range. Cancellation propagates to RPC work. No job stores private wallet or proof data.

These are load and time bounds, not a throughput guarantee. Cold history scans may take many minutes. A full browser action feed can continue after creation and is subject to the action-range request limits. The browser can poll claim creation across a long scan without holding one long HTTP response. A job can still fail if RPC is slow, the scan deadline is reached, or the backend restarts. No fixed maximum chain height is imposed.

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

The Judge fixture and public-demo `/demo` route remain synthetic. Fresh and historical public QEDIT proof results are recorded separately in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md); neither synthetic surface is public-chain ownership evidence.

## Current release acceptance (2026-10-28)

Source `59ade00c5d075ded514972b97f6da19c60087820` is deployed from the open Draft PR branch. The public health endpoint returns HTTP 200 with `network: zsa-testnet`; `/demo` still routes to the isolated synthetic backend. All three public Horoi containers are healthy. Image IDs and preserved volume identities are recorded in [DEPLOYMENT.md](DEPLOYMENT.md).

| Gate | Current evidence | Status |
| --- | --- | --- |
| Public-chain snapshot integration | Claim c19b11... at QEDIT snapshot 8457 stores the minted AssetId, threshold 1, and canonical roots. | Verified |
| Synthetic Judge flow | Valid, tampered, and replay scenarios passed on the clean-clone Judge at source 4a08917; hosted `/demo` was rechecked after 59ade00 deployment. | Verified; latest local Judge rebuild pending |
| Fresh browser proof from an eligible live note | A 5,640-byte HCP1 proof was generated from the full 529-range action feed and accepted by the live verifier; stateless valid, replay 409, tamper false. | Verified in WSL Chromium |
| Strict ChatGPT Browser criterion | The full proof used WSL Chromium to keep the key out of browser-control tool arguments; the ChatGPT in-app browser remained on the public claim page. | Partial; historical ChatGPT flow exists |
| Full cold-scan reliability | One snapshot-8457 verification completed; earlier 30-second abort and `SNAPSHOT_UNAVAILABLE` remain. A single success does not establish reliable cold-path performance. | Unresolved |

The local Judge passed `docker compose up --build` from fresh public clones at source 92710678 and 4a08917. The 59ade00 change was tested with backend and frontend checks/builds and deployed to public Compose, but the local root Judge was not rebuilt at that source because WSL Docker Engine was unavailable. The synthetic checks remain distinct from the fresh QEDIT proof.


On 2026-10-28 a fresh public clone at 4a08917 built healthy Docker Judge containers. Health and /demo returned HTTP 200; the ChatGPT in-app browser observed valid true, INVALID_PROOF, and NULLIFIER_USED. This remains synthetic Judge evidence and does not establish QEDIT note ownership.
