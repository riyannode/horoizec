# Security status

## Assets and trust boundaries

Protected assets are spending and viewing keys, decrypted note plaintext, exact private balance, private witness data, and the integrity of claim snapshots and replay records. The holder browser handles keys, decryption, scanning, witness construction, and proving. The API handles public claim data, public chain history, proof verification, and replay consumption. Zebra supplies public chain data. The Rust circuit and verifier enforce the implemented statement. SQLite stores public claim metadata and accepted alternate nullifiers.

## Private-data and logging policy

The backend must never receive a seed phrase, spending key, full viewing key, decrypted note, exact balance, or private witness. Proof payloads are accepted for verification but not logged or persisted. The accepted alternate nullifier is stored for note-level replay protection; request logs contain request ID, route, status, and duration only. No analytics, ad pixels, session replay SDK, or remote fonts are included. The spending-key input has no HTML name and is read through a local React ref, so native form fallback cannot serialize it.

## Implemented controls

Rust validates ZIP 227 v0 AssetIds and owns canonical claim/domain derivation, public input encoding, the one-note circuit, and verification. The API checks the alternate nullifier against the circuit result, re-resolves snapshot roots before acceptance, enables SQLite foreign keys, uses prepared statements, and atomically inserts the unique (claim ID, nullifier) record. Mainnet is disabled; network and pinned regtest genesis are checked, and NU7 must be active before ZSA operations.

## Replay model

Replay protection is note-level within a claim domain: the same contributing note is rejected after its alternate nullifier is consumed for that claim. It does not identify or limit a person or wallet. Different claim domains derive different alternate nullifiers under the experimental protocol relation.

## Known attacks and limitations

The proof is one-note only; split notes and aggregate balance are unsupported. Exclusion-tree correctness depends on canonical block scanning and the pinned node implementation. Reorgs or testnet resets invalidate snapshots and cause fail-closed rejection. The alternate-nullifier construction follows an open draft and is unaudited; cryptographic, circuit, implementation, and dependency review have not been performed. Denial of service, compromised browsers, malicious extensions, and compromised node/RPC availability are not prevented by this prototype.

Horoi is a testnet/regtest research prototype. Every proving screen says “ZSA TESTNET | Experimental | Unaudited | Do not use real funds.” A fresh browser-local HCP1 proof was accepted on public QEDIT ZSA testnet at snapshot 8457 on 2026-10-28, in addition to the historical snapshot-7596 run from 2026-10-25. The fresh submit-request inspection observed only claim ID, protocol version, proof, and alternate nullifier; no key or private witness was sent. These E2E results do not change the unaudited status or imply mainnet readiness. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md) for verification, replay, tamper, and privacy evidence. Mainnet, custody, wallet management, identity, and person-level Sybil resistance are non-goals. See [ERRORS.md](ERRORS.md) for failure handling.

## Docker judge and public-demo boundary

The checked-in HCP1 fixture is public test data, not a private test wallet. It contains a proof and its public statement/nullifier fields; it contains no spending key, decrypted note, exact amount, or witness. UI copy labels it **LOCAL SYNTHETIC TEST FIXTURE** and explicitly distinguishes it from public QEDIT testnet and browser-local proof generation.

`frontend/proxy.ts` applies a per-response nonce CSP to page routes. Production permits `wasm-unsafe-eval` for WebAssembly and omits `unsafe-eval`; `next.config.ts` also sets `nosniff` and `no-referrer` headers.

Both Compose modes publish only the frontend. Backend, verifier IPC, and SQLite remain on project-scoped Docker networks/volumes. In the public stack, `backend-live` has egress for configured testnet RPC and `backend-demo` has no egress. Runtime containers run as non-root, drop capabilities, use read-only roots with bounded temporary storage, and have bounded CPU/memory/PID settings. Docker build contexts exclude Git history, environment files, databases, build artifacts, and dependency directories; no secret files are copied into an image. Judge and `backend-demo` health depends on Rust deriving and verifying the pinned fixture; `backend-live` health reports API availability. Next.js routes demo API requests to `backend-demo` and other API requests to `backend-live` over their private networks.

In demo mode, claim creation and public action-range fetching are disabled, so anonymous users cannot trigger cold public snapshot construction. Only the pinned claim can be verified/submitted. Crypto routes share a 48-operation global minute budget, an 8-operation per-client minute budget when trusted proxy identity is enabled, a two-operation concurrency cap, and at most 256 in-memory client buckets. Buckets expire after one minute; overflow is rejected rather than growing the map. Rejections return 429 with `Retry-After`. Requests accept bounded JSON and logs contain route/status/duration/request ID, not proof bodies. These controls reduce exposure but are not a general-purpose public API WAF or availability guarantee.

Client identity is read only from `X-Horoi-Client-IP` when `HOROI_TRUST_PROXY_CLIENT_IP=true`; `X-Forwarded-For` is ignored. The public Compose configuration enables the setting for both proxy-facing backends. The HTTPS proxy must replace any caller-supplied `X-Horoi-Client-IP` value with its actual connection peer address, and the frontend must remain reachable only through that proxy. Local Judge mode leaves proxy trust disabled.

Each judge replay walkthrough creates a temporary SQLite database with the normal migration and closes it after two genuine HCP1 verification/insert attempts. This isolates repeated walkthroughs from shared production data. Normal claim submission retains persistent SQLite uniqueness. The checked-in fixture is public test data and contains no spending key, decrypted note, exact amount, or witness. Never publish port 8787 or mount another project's data.
