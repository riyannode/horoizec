# Hackathon positioning

## Thesis

Private assets need private composability. Horoi explores a reusable claim that a Zcash Shielded Asset holder met a threshold at a fixed snapshot without revealing exact balance, wallet address, private notes, or unrelated history.

## Problem and fit

Applications need eligibility checks for private assets, but asking holders to publish addresses or balances defeats shielding. Zcash provides shielded note commitments and OrchardZSA asset semantics. ZSA makes asset identity part of the note while preserving private value and recipient data, which gives Horoi a concrete statement to prove.

## Novelty boundary

Horoi combines ZIP 227 AssetId binding, a fixed Orchard snapshot, public standard-nullifier exclusion, a one-note threshold circuit, and claim-domain alternate nullifiers. It does not claim to invent zero-knowledge proofs, private voting, or alternate nullifiers. The alternate-nullifier design follows an unaccepted draft and has not been audited. Horoi currently supports one normal note, not aggregate holdings, split notes, person uniqueness, or unlinkability.

## Demo and evidence

The canonical judge walkthrough is [http://localhost:3000/demo](http://localhost:3000/demo), started from a fresh clone with `docker compose up --build`. It is zero-credential and uses the actual Horoi Rust/HCP1 verifier for valid, tampered, and SQLite replay scenarios. Its fixture is labeled **LOCAL SYNTHETIC TEST FIXTURE** and is not a public QEDIT testnet proof. See [DEMO.md](DEMO.md) for exact commands and limits. The public HTTPS demo URL is pending VPS deployment and external verification.

The recorded public-testnet demo used one genuine eligible note at QEDIT ZSA snapshot 7596. The browser generated an HCP1 proof, the API accepted it, stateless verification returned `valid: true`, identical replay returned HTTP 409 `NULLIFIER_USED`, and a one-bit mutation returned `valid: false`. The submit request was inspected for private-data leakage. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md) for the full record; the run is historical and its exact runtime checkout SHA was not captured.

For public HTTPS, use the Docker public profile documented in [DEPLOYMENT.md](DEPLOYMENT.md) and attach the hostname only after HTTPS, unauthenticated access, health, and API routing are verified. For any live browser proving demo, use only an already eligible, authorized testnet note after checking the active QEDIT testnet identity and snapshot. Do not issue, transfer, burn, or fund assets to reproduce the demo. If no eligible public note is available, present the recorded evidence and label it as historical. Never present a local fixture as a public-testnet result.

The `u64::MAX` insufficient-balance test returned `NoEligibleNote` for the same test-wallet note data. It is a negative threshold test, not a second holder named Bob. The Alice/Bob example in PRD §27 is illustrative only; no two-holder public-testnet demo has been demonstrated. The separate 2026-10-22 local-regtest run is fixture evidence, not public-testnet evidence.

## Limitations

The implementation is experimental and unaudited, runs against pinned testnet/regtest software, and has one recorded public-testnet acceptance result for one normal note. It has no demonstrated Alice/Bob pair, aggregate balance, or split-note proof. Mainnet is not supported. Replay protection is note-level within a claim domain, not person-level or wallet-level. Cold snapshot latency remains unreliable: a historical baseline was 509,443 ms; later completed local-only runs took 840,604–919,090 ms, and a separate latest request exceeded the 900,000 ms client boundary without a captured HTTP response. The cause was not isolated; see the report.

See [SETUP.md](SETUP.md), [CRYPTO.md](CRYPTO.md), [TESTING.md](TESTING.md), and [REFERENCES.md](REFERENCES.md) for source revisions, measured results, and validation scope.

## Copy-ready ZECATHON description

Horoi lets applications verify that a Zcash Shielded Asset holder meets a threshold at a fixed snapshot without asking them to reveal an address, exact balance, or unrelated note history. Because ZSAs use shielded Orchard notes, ordinary eligibility checks based on public addresses defeat the privacy those assets provide.

Horoi combines ZIP 227 AssetId binding, immutable snapshot roots, a one-note Halo2 ownership circuit, and HCP1 verification. The browser-local Rust/WASM prover constructs the witness and proof; the API receives only the proof, claim ID, protocol version, and claim-specific alternate nullifier. SQLite enforces note-level replay protection within each claim domain.

The local Docker Judge Demo verifies a deterministic, explicitly labeled synthetic test fixture with the native Rust verifier and demonstrates tamper rejection and replay handling. Separate historical evidence records one public QEDIT ZSA testnet proof flow. The project is experimental, unaudited, limited to one normal note, and does not support mainnet or aggregate wallet balances.

**Character count:** 1,077 including spaces and paragraph breaks; below the 2,000-character limit.

## Two-minute demo video script

Target runtime: 110–118 seconds. Record the Docker Judge Demo from a clean local volume; keep the `LOCAL SYNTHETIC TEST FIXTURE` label visible. Do not describe it as a public-chain proof or as new browser proof generation.

| Time | Screen | Narration |
| --- | --- | --- |
| 0–15 s | `/demo` title and privacy copy | “Zcash Shielded Assets protect holder and value, but applications still need eligibility checks. Asking users to publish an address or balance undermines that privacy.” |
| 15–30 s | Horoi introduction | “Horoi is a prototype for proving that a private asset note meets a threshold at a fixed snapshot, while keeping the note and exact value private.” |
| 30–48 s | Public claim statement and fixture provenance | “This claim binds the network, ZIP 227 AssetId, threshold, snapshot height, and commitment and exclusion roots. This Docker fixture is synthetic local regtest evidence, not a QEDIT testnet snapshot.” |
| 48–66 s | Click **Verify valid fixture** | “The backend sends the pinned HCP1 bundle through Horoi’s native Rust verifier. The result is valid because the cryptographic verifier accepts it.” |
| 66–80 s | Click **Verify tampered fixture** | “Now the backend flips one proof byte and runs the same verifier. It returns `INVALID_PROOF`; the page does not hardcode a rejection.” |
| 80–96 s | Click **Run replay scenario** | “The first proof submission is accepted. SQLite records its claim-specific alternate nullifier; submitting the same note proof again returns `NULLIFIER_USED`.” |
| 96–108 s | Privacy boundary panel | “AssetId, threshold, snapshot statement, result, and claim-specific nullifier are public. Spending key, exact value, witness, note details, and wallet identity stay private.” |
| 108–118 s | Brief architecture or repository view | “Browser-local Rust/WASM proving is separate from this server-side fixture walkthrough. Horoi supports one normal note, remains experimental and unaudited, and does not support mainnet or aggregate balances.” |

No recording or video URL is included yet. Record and review the 110–118 second capture after the public HTTPS demo route is assigned and verified; upload/publish it only with separate approval.

## Prepared submission fields

- **Project name:** Horoi
- **Track:** Core & Tooling
- **Repository:** https://github.com/riyannode/horoizec (currently private; user visibility action remains)
- **Working demo URL:** Pending a Horoi hostname and safe HTTPS route on the authorized VPS.
- **Video URL:** Pending recording and separately authorized publication.
- **Registered account:** @hpelong377
- **Telegram contact:** @riyanhcr
- **Draft PR:** https://github.com/riyannode/horoizec/pull/1
- **Final submitted:** No; do not submit without explicit authorization.
