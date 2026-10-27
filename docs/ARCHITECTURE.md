# Architecture

Horoi has the five MVP Next.js routes plus the authorized ZECATHON `/demo` walkthrough, a Bun/Hono API with SQLite, one canonical Rust claim library shared with browser WASM and the native verifier, and an optional QEDIT Zebra RPC connection for non-demo operation.

```mermaid
flowchart LR
  Holder[Browser] -->|HTTP :3000| Next[Next.js frontend]
  Next -->|/api proxy to backend:8787| API[Bun/Hono API]
  Holder -->|local key, scan, witness, proof in non-demo mode| WASM[Rust WASM]
  API --> DB[(SQLite claims and consumed alternate nullifiers)]
  API --> Verifier[Native Rust verifier]
  API -. optional non-demo path .-> RPC[QEDIT Zebra JSON-RPC]
  Verifier --> Core[Rust ClaimVerifier]
```

## Docker execution modes and trust boundaries

The default root `docker-compose.yml` is **DOCKER JUDGE DEMO**. Browser traffic reaches the Next.js production container on port 3000; Next.js proxies `/api` to `http://backend:8787` over an internal Compose network. The backend runs the native `horoi-verifier` and writes replay state to a project-scoped persistent SQLite volume. Only the frontend port is published to the host. This mode has no `.env`, RPC credentials, public-chain access, or snapshot scan at startup.

Judge and public Docker modes both load the exact pinned HCP1 fixture and the same Rust verifier. At startup Rust derives the claim ID/domain and verifies the positive proof before the backend is marked healthy. The local synthetic roots are pinned to the fixture and are not resolved against Zebra or QEDIT public testnet. The tamper and replay scenarios pass through the native verifier; the replay walkthrough uses the same migration and atomic unique-key SQLite operation as normal submission inside a request-local database that is closed afterward. Normal claims continue to use persistent SQLite. `/demo` fixture verification is distinct from browser-local WASM proof generation.

The optional public Compose profile uses project `horoi-public`, with its own network, volume, and containers. Only the frontend binds to VPS loopback port 3001; Next.js proxies privately to `backend:8787`, and the backend/database have no host-published ports. Demo-mode claim creation and action-range fetching are disabled. Crypto admission has a 48-unit global minute budget, an 8-unit per-client budget when the trusted proxy header is enabled, a two-operation concurrency cap, and a bounded 256-entry client map. The separate `docker-compose.public.yml` enables trusted client IP handling; the HTTPS proxy must overwrite `X-Horoi-Client-IP` with its actual peer address. Arbitrary `X-Forwarded-For` values are ignored. The local judge Compose keeps proxy trust disabled.

## Proof flow

A creator sends public name, description, ZIP 227 AssetId bytes, threshold, snapshot height, and optional expiry. The backend validates the AssetId, reads the Orchard commitment root and canonical public Orchard nullifiers from the selected chain history, derives the exclusion root, then stores immutable claim metadata including network identity and a random creator nonce.

A holder provides a test-only spending key in the claim page. The browser fetches public action ranges and public issuance fields. WASM reconstructs issuance notes, checks commitments, decrypts candidate outputs, computes commitment and exclusion witnesses, and creates a one-note proof locally. The browser submits the proof bundle and circuit-derived alternate nullifier. It does not send the key, viewing key, decrypted notes, witness, exact balance, or queried holder nullifier.

The API loads the stored claim, passes the bundle to the native Rust verifier, checks the alternate nullifier against the circuit result, re-resolves both snapshot roots against the active chain, then atomically consumes the alternate nullifier under the claim ID. The same contributing note is rejected again within that claim domain. Different claim domains produce different alternate nullifiers under the implemented relation.

## Boundaries and limitations

Rust owns canonical encoding, AssetId and AssetBase handling, claim/domain derivation, circuit, proof serialization, and verification. TypeScript validates HTTP shapes and stores public metadata; it does not implement cryptographic rules. SQLite stores public claims and accepted alternate nullifiers, not proof bodies. The proof handles one normal note, with no split-note or four-note aggregation. The exclusion tree and alternate-nullifier design are experimental and unaudited. Local QEDIT Zebra regtest E2E passed; a real browser HCP1 proof was accepted on public QEDIT ZSA testnet at snapshot 7596 on 2026-10-25. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md) for replay, verification, privacy, and measurement evidence.
