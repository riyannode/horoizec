# Hackathon positioning

## Thesis

Private assets need private composability. Horoi explores a reusable claim that a Zcash Shielded Asset holder met a threshold at a fixed snapshot without revealing exact balance, wallet address, private notes, or unrelated history.

## Problem and fit

Applications need eligibility checks for private assets, but asking holders to publish addresses or balances defeats shielding. Zcash provides shielded note commitments and OrchardZSA asset semantics. ZSA makes asset identity part of the note while preserving private value and recipient data, which gives Horoi a concrete statement to prove.

## Novelty boundary

Horoi combines ZIP 227 AssetId binding, a fixed Orchard snapshot, public standard-nullifier exclusion, a one-note threshold circuit, and claim-domain alternate nullifiers. It does not claim to invent zero-knowledge proofs, private voting, or alternate nullifiers. The alternate-nullifier design follows an unaccepted draft and has not been audited. Horoi currently supports one normal note, not aggregate holdings, split notes, person uniqueness, or unlinkability.

## Demo and evidence

1. Start the pinned QEDIT Zebra regtest and issue the local demo ZSA using [SETUP.md](SETUP.md).
2. Open the app, create a claim for that AssetId and snapshot, then browse the claim.
3. Enter the local test-only spending key in the claim page and generate a browser-local proof.
4. Submit and verify it, then submit the same contributing note again to show note-level replay rejection.
5. Tamper with the proof bundle and show INVALID. Inspect Network requests to confirm no key, decrypted note, witness, or exact balance is sent.

The 2026-10-22 local regtest browser run reconstructed an issued note from public transaction fields, generated a proof in WASM, accepted it in the API, rejected the repeat with HTTP 409, returned VALID for the original proof, and INVALID for a tampered bundle. A separate native synthetic-note run measured setup plus proving at 45,464 ms and a 5,640-byte HCP1 serialized bundle. This is not browser latency or a public testnet result.

## Limitations

The implementation is experimental and unaudited, runs against pinned testnet/regtest software, and has no public testnet E2E acceptance result. Proofs cover one normal note only. No aggregate balance or split-note proof exists. Mainnet is not supported. Replay protection is note-level within a claim domain, not person-level or wallet-level.

See [SETUP.md](SETUP.md), [CRYPTO.md](CRYPTO.md), [TESTING.md](TESTING.md), and [REFERENCES.md](REFERENCES.md) for source revisions, measured results, and validation scope.
