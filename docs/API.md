# API

Base path: /api/v1. JSON uses decimal strings for thresholds and hexadecimal strings for field and identifier values. Errors use the envelope documented in [ERRORS.md](ERRORS.md). Routes fail closed on inconsistent chain state and do not log request bodies.

Unexpected server failures use `INTERNAL_ERROR` (500). Native verifier bridge failures retain the existing `VERIFIER_UNAVAILABLE` (503) API code.

## GET /health

Request: no body or query.

Response 200: { "ok": true, "version": "1.0.0", "network": "zebra-regtest" }.

## GET /claims?limit=&cursor=

Request: optional limit (default 20, clamped to 1..100) and optional cursor (claim ID).

Response 200: { "claims": [Claim] }. Claim fields: id, protocolVersion, networkId, name, description, assetId, threshold, snapshotHeight, commitmentRoot, exclusionRoot, claimDomain, creatorNonce, expiresAt, createdAt, and computed status (active or expired).

Errors: none for malformed pagination; non-numeric limit falls back to 20.

## GET /claims/:id

Request: claim ID as path segment; no body.

Response 200: { "claim": Claim }.

Errors: CLAIM_NOT_FOUND (404).

## GET /snapshots/:height/actions?start=&end=

Request: snapshot height in the path and inclusive start/end heights in query. The range must be ordered, within the snapshot, and at most 16 blocks.

Response 200: { "blocks": [ { "height", "hash", "transactions": [ { "actions": [ { "nullifier", "cmx", "ephemeralKey", "encCiphertext" } ], "issuanceNotes": [ { "cmx", "assetBase", "recipient", "value", "rho", "rseed" } ] } ] } ] }. These are public chain fields; issuance records let the browser reconstruct notes locally.

Errors: INVALID_SNAPSHOT (400), NETWORK_MISMATCH (400), MAINNET_DISABLED (403), ZSA_UNSUPPORTED (400), SNAPSHOT_UNAVAILABLE (503), ZCASH_RPC_UNAVAILABLE (503).

## POST /claims

Request JSON: { "name": string, "description": string (optional, defaults to empty), "assetId": 66-byte ZIP 227 v0 hex, "threshold": positive u64 decimal string, "snapshotHeight": non-negative u32 integer, "expiresAt": positive Unix seconds or null (optional, defaults to null) }.

Response 201: { "claim": Claim }. Roots, claim ID, claim domain, network ID, and creator nonce are derived server-side and immutable after creation.

Errors: BAD_REQUEST, INVALID_ASSET_ID, INVALID_THRESHOLD, INVALID_SNAPSHOT, NETWORK_MISMATCH, ZSA_UNSUPPORTED (all 400); MAINNET_DISABLED (403); SNAPSHOT_UNAVAILABLE, ZCASH_RPC_UNAVAILABLE, VERIFIER_UNAVAILABLE (503).

## POST /proofs/verify

Request JSON: { "claimId": 64-character lowercase hex, "protocolVersion": 1, "proof": base64 HCP1 bundle, "alternateNullifiers": [one 32-byte lowercase hex field encoding] }.

Response 200 for invalid cryptographic proof: { "valid": false, "claimId": string }. Response 200 for valid proof: { "valid": true, "claimId": string, "statement": { "assetId": string, "threshold": string, "snapshotHeight": number, "protocolVersion": 1 }, "alternateNullifier": string }.

Errors: BAD_REQUEST (400), CLAIM_NOT_FOUND (404), CLAIM_EXPIRED (410), PROOF_INPUT_MISMATCH (400), SNAPSHOT_STALE (409), SNAPSHOT_UNAVAILABLE, ZCASH_RPC_UNAVAILABLE, VERIFIER_UNAVAILABLE (503).

## POST /claims/:id/submit

Request JSON: same as POST /proofs/verify; path ID must equal claimId.

Response 200: { "accepted": true, "replayProtection": "note-level" }.

Errors: BAD_REQUEST (400), CLAIM_NOT_FOUND (404), CLAIM_EXPIRED (410), PROOF_INVALID, PROOF_INPUT_MISMATCH (400), SNAPSHOT_STALE, NULLIFIER_USED (409), SNAPSHOT_UNAVAILABLE, ZCASH_RPC_UNAVAILABLE, VERIFIER_UNAVAILABLE (503).

The verifier bridge uses one JSON request and response per line. HCP1 hex is used internally; HTTP accepts base64. Proof payloads are never persisted. See [ERRORS.md](ERRORS.md) for user messages and operator actions.
