# API

Base path: /api/v1. JSON uses decimal strings for thresholds and hexadecimal strings for field and identifier values. Errors use the envelope documented in [ERRORS.md](ERRORS.md). Routes fail closed on inconsistent chain state and do not log request bodies.

Unexpected server failures use `INTERNAL_ERROR` (500). Native verifier bridge failures retain the existing `VERIFIER_UNAVAILABLE` (503) API code.

## GET /health

Request: no body or query.

Response 200: { "ok": true, "version": "1.0.0", "network": "zebra-regtest" }.

## Docker Judge Demo routes

These routes exist only when `HOROI_DEMO_MODE=true`. They use the pinned `judge-hcp1` fixture and the same native Rust verifier as regular proof verification. No private key, witness, or proof bytes are returned by the fixture endpoint.

### GET /demo/fixture

Response 200: public fixture provenance, claim ID, network/protocol identifiers, AssetId, threshold, snapshot height and roots, and the claim-specific alternate nullifier.

### POST /demo/verify

Request JSON: `{ "scenario": "valid" | "tampered" }`. For `valid`, the backend must receive `valid=true` and the fixture's actual alternate nullifier from Rust or returns a service error. For `tampered`, the backend flips a proof byte; `valid:false` is returned only if Rust rejects it with `INVALID_PROOF`. The proof itself never comes from the browser.

Errors: BAD_REQUEST (400), DEMO_FIXTURE_INVALID (503), DEMO_TAMPER_CHECK_FAILED (503), RATE_LIMITED (429).

### POST /demo/submit

Request JSON: `{ "fixtureId": "judge-hcp1" }`. Each request creates a temporary in-memory SQLite database from the normal migration, inserts the pinned public claim, and runs the same native HCP1 acceptance path twice. Both calls verify the proof and use the same atomic SQLite nullifier insert; the first insert succeeds and the duplicate fails with `NULLIFIER_USED`. The database closes when the request completes, so each walkthrough starts clean and does not alter persistent judge or public claim state.

Response 200: `{ "firstSubmission": { "accepted": true }, "replay": { "accepted": false, "errorCode": "NULLIFIER_USED" }, "replayProtection": "note-level", "state": "isolated-sqlite-per-run", "alternateNullifier": string }`. These are the results of the two real verifier/database operations inside one walkthrough request, not simulated HTTP 201/409 responses.

Crypto routes have a process-wide budget of 48 operation units per minute, an 8-unit per-client budget when `HOROI_TRUST_PROXY_CLIENT_IP=true` and a valid `X-Horoi-Client-IP` is supplied by the configured proxy, a two-operation concurrency cap in demo mode, and at most 256 client buckets. Claim submission and demo submission cost two units. Rejections return HTTP 429 with `Retry-After`. `X-Forwarded-For` is never used as client identity. Live claim creation also has a 4-per-15-minute process limit and one-per-client limit when trusted identity is available; schema and native AssetId validation happen first. Live claim creation, proof verification, synchronous claim submission, and action-range requests have a 14-minute deadline that propagates client disconnects and timeout cancellation through native verification and RPC. A snapshot scan has a single-process admission gate and a 12-minute total deadline. The asynchronous proof-submission endpoint below uses its own bounded 14-minute worker deadline and is not tied to the initiating request connection.

Demo mode also returns DEMO_READ_ONLY (403) for claim creation and public action-range fetching. These safeguards prevent cold public-chain scanning in Docker.

## GET /claims?limit=&cursor=&status=

Request: optional limit (default 20, clamped to 1..100), cursor (claim ID), and status (`active` or `expired`). Status is computed at request time and filtered before descending-ID cursor pagination. An unsupported status returns `BAD_REQUEST` (400); non-numeric limit falls back to 20.

Response 200: { "claims": [Claim] }. Claim fields: id, protocolVersion, networkId, name, description, assetId, threshold, snapshotHeight, commitmentRoot, exclusionRoot, claimDomain, creatorNonce, expiresAt, createdAt, and computed status (active or expired).

Errors: BAD_REQUEST (400) for unsupported status. Malformed pagination does not error; non-numeric limit falls back to 20.

## GET /claims/:id

Request: claim ID as path segment; no body.

Response 200: { "claim": Claim }.

Errors: CLAIM_NOT_FOUND (404).

## GET /snapshots/:height/actions?start=&end=

Request: snapshot height in the path and inclusive start/end heights in query. The range must be ordered, within the snapshot, and at most 16 blocks. Live mode also limits action-range requests to 120 per trusted client and 600 globally per minute.

Response 200: { "blocks": [ { "height", "hash", "transactions": [ { "actions": [ { "nullifier", "cmx", "ephemeralKey", "encCiphertext" } ], "issuanceNotes": [ { "cmx", "assetBase", "recipient", "value", "rho", "rseed" } ] } ] } ] }. These are public chain fields; issuance records let the browser reconstruct notes locally.

Errors: INVALID_SNAPSHOT (400), NETWORK_MISMATCH (400), MAINNET_DISABLED (403), ZSA_UNSUPPORTED (400), RATE_LIMITED (429), SNAPSHOT_UNAVAILABLE (503), ZCASH_RPC_UNAVAILABLE (503).

## POST /claims

Request JSON: { "name": string, "description": string (optional, defaults to empty), "assetId": 66-byte ZIP 227 v0 hex, "threshold": positive u64 decimal string, "snapshotHeight": non-negative u32 integer, "expiresAt": positive Unix seconds or null (optional, defaults to null) }.

Response 201: { "claim": Claim }. Roots, claim ID, claim domain, network ID, and creator nonce are derived server-side and immutable after creation.

Errors: BAD_REQUEST, INVALID_ASSET_ID, INVALID_THRESHOLD, INVALID_SNAPSHOT, NETWORK_MISMATCH, ZSA_UNSUPPORTED (all 400); MAINNET_DISABLED (403); SNAPSHOT_UNAVAILABLE, ZCASH_RPC_UNAVAILABLE, VERIFIER_UNAVAILABLE (503).

## POST /claims/jobs

Request JSON: same as `POST /claims`. Schema and native AssetId validation happen before snapshot admission.

Response 202: `{ "jobId": string, "status": "running", "stage": string }`. The live backend performs the same canonical network/genesis checks, snapshot hash/root resolution, reorg checks, claim derivation, and SQLite insertion as `POST /claims`. The job has a 14-minute deadline, and one snapshot scan runs at a time per backend process. Its `stage` reports the last completed scan range as `snapshot_scan_through_<height>`. Completed 16-block ranges may be resumed from process-memory checkpoints only after the current canonical end hash matches; the final snapshot hash/root and reorg checks still run before a claim is inserted. Checkpoints are bounded to one snapshot, 10,000 ranges, and 200,000 nullifiers. Job status and checkpoints are not persisted and are lost on backend restart; status is retained in memory for up to 30 minutes.

Errors: the same validation and network errors as `POST /claims`, plus RATE_LIMITED (429) when a scan is already active or the bounded job table is full.

## GET /claims/jobs/:jobId

Response 200 while running: `{ "jobId": string, "status": "running", "stage": string }`. On completion, the response includes `claim`; on failure, it includes a safe `{ "code", "message" }` error. Terminal statuses are `completed`, `failed`, and `cancelled`.

Errors: CLAIM_JOB_NOT_FOUND (404) if the job is unknown, expired, or lost during a backend restart.

## POST /claims/jobs/:jobId/cancel

Request: no body. Aborts an active job and propagates cancellation to its snapshot/RPC work. A job that already completed or failed returns its current status without changing the claim.

Response 200: the current job status object.

Errors: CLAIM_JOB_NOT_FOUND (404).

## POST /proofs/verify

Request JSON: { "claimId": 64-character lowercase hex, "protocolVersion": 1, "proof": base64 HCP1 bundle, "alternateNullifiers": [one 32-byte lowercase hex field encoding] }.

Response 200 for invalid cryptographic proof: { "valid": false, "claimId": string }. Response 200 for valid proof: { "valid": true, "claimId": string, "statement": { "assetId": string, "threshold": string, "snapshotHeight": number, "protocolVersion": 1 }, "alternateNullifier": string }.

Errors: BAD_REQUEST (400), CLAIM_NOT_FOUND (404), CLAIM_EXPIRED (410), PROOF_INPUT_MISMATCH (400), SNAPSHOT_STALE (409), SNAPSHOT_UNAVAILABLE, ZCASH_RPC_UNAVAILABLE, VERIFIER_UNAVAILABLE (503).

## POST /claims/:id/submit

Request JSON: same as POST /proofs/verify; path ID must equal claimId.

Response 200: { "accepted": true, "replayProtection": "note-level" }.

Errors: BAD_REQUEST (400), CLAIM_NOT_FOUND (404), CLAIM_EXPIRED (410), PROOF_INVALID, PROOF_INPUT_MISMATCH (400), SNAPSHOT_STALE, NULLIFIER_USED (409), SNAPSHOT_UNAVAILABLE, ZCASH_RPC_UNAVAILABLE, VERIFIER_UNAVAILABLE (503).

## POST /claims/:id/submit/jobs

Request JSON: same as `POST /claims/:id/submit`.

Response 202: `{ "jobId": string, "status": "running", "stage": string }`. The worker runs the same native HCP1 verifier, canonical snapshot/reorg validation, claim-expiry check, and atomic nullifier consumption as the synchronous endpoint. Only one proof-submission job may run per backend process. Its 14-minute deadline aborts verifier/RPC work; cancellation is available through the endpoint below. Jobs and status are held in process memory for at most 30 minutes and are lost on backend restart. The submitted proof exists only in the worker's memory while verification runs; it is not returned by status responses or written to logs or persistent storage.

Errors: CLAIM_NOT_FOUND (404), CLAIM_EXPIRED (410), PROOF_INPUT_MISMATCH (400), RATE_LIMITED (429) when another proof job is active or the bounded job table is full.

## GET /claims/:id/submit/jobs/:jobId

Response 200 while running: `{ "jobId": string, "status": "running", "stage": string }`. Completion includes `{ "accepted": true, "replayProtection": "note-level" }`; failure includes a safe `{ "code", "message" }` error. The proof is never returned.

Errors: PROOF_JOB_NOT_FOUND (404) if the job is unknown, its claim ID differs, expired, or lost during a backend restart.

## POST /claims/:id/submit/jobs/:jobId/cancel

Request: no body. Aborts active native verification or snapshot validation. A terminal job returns its current status without changing a completed nullifier result.

Response 200: the current job status object.

Errors: PROOF_JOB_NOT_FOUND (404).

The verifier bridge uses one JSON request and response per line. HCP1 hex is used internally; HTTP accepts base64. Proof payloads are never persisted. See [ERRORS.md](ERRORS.md) for user messages and operator actions.
