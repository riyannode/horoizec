# Hackathon positioning

## Thesis

Private assets need private composability. Horoi explores a reusable claim that a Zcash Shielded Asset holder met a threshold at a fixed snapshot without revealing exact balance, wallet address, private notes, or unrelated history.

## Problem and fit

Applications need eligibility checks for private assets, but asking holders to publish addresses or balances defeats shielding. Zcash provides shielded note commitments and OrchardZSA asset semantics. ZSA makes asset identity part of the note while preserving private value and recipient data, which gives Horoi a concrete statement to prove.

## Novelty boundary

Horoi combines ZIP 227 AssetId binding, a fixed Orchard snapshot, public standard-nullifier exclusion, a one-note threshold circuit, and claim-domain alternate nullifiers. It does not claim to invent zero-knowledge proofs, private voting, or alternate nullifiers. The alternate-nullifier design follows an unaccepted draft and has not been audited. Horoi currently supports one normal note, not aggregate holdings, split notes, person uniqueness, or unlinkability.

## Demo and evidence

The canonical zero-credential judge walkthrough is [http://localhost:3000/demo](http://localhost:3000/demo), started from a fresh clone with `docker compose up --build`. It uses the actual Horoi Rust/HCP1 verifier for valid, tampered, and SQLite replay scenarios. Its fixture is labeled **LOCAL SYNTHETIC TEST FIXTURE** and is not a public QEDIT testnet proof. See [DEMO.md](DEMO.md) for exact commands and limits.

The public Docker demo is live at [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo). External HTTPS and browser acceptance on 2026-10-27 confirmed the page, proxied API, genuine fixture verification, tamper rejection, and repeatable isolated-SQLite replay. It runs the same pinned synthetic fixture; it is not a live-chain proof or a new browser wallet proving session. See [DEPLOYMENT.md](DEPLOYMENT.md) for the source revision, image digests, Caddy route, and UNMET preservation checks.

Current evaluation paths keep three surfaces separate: the [full application](https://horoi.kima.my.id) routes ordinary API calls to backend-live; the hosted [synthetic /demo](https://horoi.kima.my.id/demo) routes to backend-demo; and the local Judge starts with docker compose up --build. Application source `59ade00c5d075ded514972b97f6da19c60087820` is deployed; the current documentation update is included in open Draft PR #1. A fresh proof for the eligible note at snapshot 8457 was accepted by the live verifier. The /demo fixture remains synthetic and is not public-testnet evidence. See THREE_SURFACES.md and DEPLOYMENT.md.
The recorded public-testnet demo used one genuine eligible note at QEDIT ZSA snapshot 7596. The browser generated an HCP1 proof, the API accepted it, stateless verification returned `valid: true`, identical replay returned HTTP 409 `NULLIFIER_USED`, and a one-bit mutation returned `valid: false`. The submit request was inspected for private-data leakage. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md) for the full record; the run is historical and its exact runtime checkout SHA was not captured.

An earlier async `/create` attempt on 2026-10-27 returned HTTP 202, then `SNAPSHOT_UNAVAILABLE` before insertion after about 11m24s; its public stage was `snapshot_resolution` and its internal RPC cause could not be retrieved. On 2026-10-28 a retry persisted the snapshot-8457 claim. An initial browser scan was interrupted at block 4016/8457, before proof generation. The later completed run resumed from a validated public-only action cache, verified all 529 ranges against canonical range-end hashes, and generated and submitted a fresh proof successfully. The interruption is retained here as historical attempt evidence; it is not the final E2E result. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md) for the complete record and limits.

The disposable account-0 key derivation was validated against Cachet's source path. Cachet minted one minimal test asset, transaction `38532f264341786558ac364609440917d6d1541bc4ebbf37c51efb7203a3df42`, included in QEDIT block 8457. The issuance is confirmed, but Horoi has not yet confirmed that its issuance note is eligible for the existing circuit. No transfer or second mint was made. Never present a local fixture as a public-testnet result.

The `u64::MAX` insufficient-balance test returned `NoEligibleNote` for the same test-wallet note data. It is a negative threshold test, not a second holder named Bob. The Alice/Bob example in PRD §27 is illustrative only; no two-holder public-testnet demo has been demonstrated. The separate 2026-10-22 local-regtest run is fixture evidence, not public-testnet evidence.


## PRD §24 acceptance A–L (2026-10-28)

Statuses follow the evidence recorded for this release; historical public-testnet results are not attributed to the Docker fixture.

| Item | Status | Evidence and limit |
| --- | --- | --- |
| A. Repository structure | `PASS_CURRENTLY_VERIFIED` | Tracked project directories are `backend/`, `frontend/`, and `docs/`; root Compose files are the authorized deployment configuration. |
| B. Compatible pinned ZSA environment | `PARTIAL` | The live RPC reports `chain=test`, the QEDIT genesis, active NU7, and Zebra 5.2.0/protocol 170160; canonical snapshot 8457 has the recorded hash and Orchard root. The current RPC does not expose the running Zebra Git revision, so the exact deployed revision cannot be confirmed. |
| C. Immutable AssetId, threshold, and snapshot claim | `PASS_CURRENTLY_VERIFIED` | New public claim c19b11d72b79fab77b21942e031ae52ac177550a9a19de3a3ecee0fb1a40060e binds the minted ZIP 227 AssetId, threshold 1, and canonical snapshot-8457 roots. |
| D. Client-side wallet privacy | `PASS_CURRENTLY_VERIFIED` | The fresh live proof request included only claim ID, protocol version, proof, and alternate nullifier; no key, note, balance, or witness was observed in requests. |
| E. Genuine ZK ownership proof | `PASS_CURRENTLY_VERIFIED` | A fresh 5,640-byte HCP1 proof for the confirmed QEDIT mint note was accepted by the deployed native Rust verifier at snapshot 8457. |
| F. Verification and tamper rejection | `PASS_CURRENTLY_VERIFIED` | Live stateless verification returned `valid: true`; a one-byte-mutated proof returned `valid: false`. The Docker Judge valid/tamper scenarios remain separately labeled synthetic evidence. |
| G. Note-level replay protection | `PASS_CURRENTLY_VERIFIED` | Replaying the identical live proof returned HTTP 409 `NULLIFIER_USED`; the synthetic Judge replay check remains separate. |
| H. Claim-domain separation | `PASS_CURRENTLY_VERIFIED` | `cargo +1.99.1 test --locked` passed all 18 Rust tests, including deterministic claim-domain and alternate-nullifier domain-separation cases. |
| I. Complete browser E2E | `PARTIAL` | The fresh full proof flow ran in WSL Chromium. The strict ChatGPT Browser criterion remains historical-only from 2026-10-25. |
| J. Rust/backend/frontend/Docker build | `PARTIAL` | Source 59ade00 passed backend tests/check/build and frontend check/build; the live Compose services are healthy. Root Docker Judge acceptance was last reproduced on 4a08917, not 59ade00. |
| K. Documentation consistency | `PASS_CURRENTLY_VERIFIED` | Setup, API, architecture, security, Docker, hackathon, and historical E2E documents describe the current implementation and provenance separately. |
| L. Testnet and product limitations disclosed | `PASS_CURRENTLY_VERIFIED` | Documentation labels the synthetic fixture, experimental/unaudited status, one-note scope, note-level replay, and lack of a demonstrated public-testnet Alice/Bob pair. |

The public application is available at [https://horoi.kima.my.id](https://horoi.kima.my.id); its synthetic Judge walkthrough is at [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo). Hosted synthetic-fixture acceptance does not replace or extend the historical public QEDIT testnet proof record.

## Limitations

The implementation is experimental and unaudited, runs against pinned testnet/regtest software, and has one fresh and one historical public-testnet acceptance result for one normal note. It has no demonstrated Alice/Bob pair, aggregate balance, or split-note proof. Mainnet is not supported. Replay protection is note-level within a claim domain, not person-level or wallet-level. One snapshot-8457 proof job completed in 255,232 ms, but this single run does not establish cold-scan reliability. The earlier 30-second request owner's exact layer and the earlier async job's `SNAPSHOT_UNAVAILABLE` cause remain unknown. See the report for the evidence boundary.

See [SETUP.md](SETUP.md), [CRYPTO.md](CRYPTO.md), [TESTING.md](TESTING.md), and [REFERENCES.md](REFERENCES.md) for source revisions, measured results, and validation scope.

## Copy-ready ZECATHON description

Horoi lets applications verify that a Zcash Shielded Asset holder meets a threshold at a fixed snapshot without asking them to reveal an address, exact balance, or unrelated note history. Because ZSAs use shielded Orchard notes, ordinary eligibility checks based on public addresses defeat the privacy those assets provide.

Horoi combines ZIP 227 AssetId binding, immutable snapshot roots, a one-note Halo2 ownership circuit, and HCP1 verification. The browser-local Rust/WASM prover constructs the witness and proof; the API receives only the proof, claim ID, protocol version, and claim-specific alternate nullifier. SQLite enforces note-level replay protection within each claim domain.

The local Docker Judge Demo verifies a deterministic, explicitly labeled synthetic test fixture with the native Rust verifier and demonstrates tamper rejection and replay handling. Separate records document the fresh 2026-10-28 QEDIT proof at snapshot 8457 and the historical 2026-10-25 proof at snapshot 7596. The project is experimental, unaudited, limited to one normal note, and does not support mainnet or aggregate wallet balances.

**Character count:** 1,077 including spaces and paragraph breaks; below the 2,000-character limit.

## Two-minute demo video storyboard

The final browser recording is 111.92 seconds in WebM format. It uses the public application and hosted demo; the synthetic fixture label stays visible. The live QEDIT proof result is labeled as a recorded 2026-10-28 result, not a second proof run. The local Docker Judge segment states its latest clean-clone run was source `4a08917` and that a rebuild at `59ade00` was unavailable.

| Time | Screen | On-screen caption |
| --- | --- | --- |
| 0–12 s | Full application | Private ZSA ownership claims · live QEDIT testnet · experimental and unaudited. |
| 12–23 s | Public claims list | Public claim statements bind the ZIP 227 AssetId, threshold, and snapshot. |
| 23–35 s | Snapshot-8457 claim | One-note threshold claim with canonical public roots. |
| 35–53 s | Recorded live E2E result | Fresh 5,640-byte HCP1 proof accepted; stateless valid; replay 409; tamper invalid. No private fields sent. |
| 53–61 s | Hosted `/demo` | Explicitly labeled synthetic fixture, isolated from the live QEDIT backend. |
| 61–70 s | Verify valid fixture | Native Rust verifier returns `valid: true`. |
| 70–78 s | Verify tampered fixture | Native Rust verifier rejects the mutation with `INVALID_PROOF`. |
| 78–87 s | Replay walkthrough | First synthetic submission accepted; duplicate returns `NULLIFIER_USED`. |
| 87–99 s | Three evaluation surfaces | Full app, hosted synthetic demo, and Docker Judge command with the latest verified-revision caveat. |
| 99–112 s | Privacy and limitations | Keys and witness stay browser-local; testnet-only, one normal note, unaudited, no person-level uniqueness; cold-scan reliability unresolved. |

The final 111.92-second WebM recording is a local task artifact, not stored in the repository or published. No public video URL is available. The submission form remains unsubmitted.

## Prepared submission fields

- **Project name:** Horoi
- **Track:** Core & Tooling
- **Repository:** https://github.com/riyannode/horoizec (public; unauthenticated clone verified on 2026-10-27)
- **Live application:** https://horoi.kima.my.id
- **Working demo URL:** https://horoi.kima.my.id/demo (public HTTPS, unauthenticated Docker deployment; synthetic local fixture).
- **Docker Judge command:** `docker compose up --build` (clean-clone Judge runs passed at sources `9271067` and `4a08917`; the latest `59ade00` root Judge was not rebuilt because WSL Docker Engine was unavailable).
- **Video:** Local 111.92-second WebM prepared; publication link pending.
- **Registered account:** @hpelong377
- **Telegram contact:** @riyanhcr
- **Draft PR:** https://github.com/riyannode/horoizec/pull/1
- **Final submitted:** No; do not submit without explicit authorization.
