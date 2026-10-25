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

Horoi is a testnet/regtest research prototype. Every proving screen says “ZSA TESTNET | Experimental | Unaudited | Do not use real funds.” A real browser HCP1 proof was accepted on public QEDIT ZSA testnet at snapshot 7596 on 2026-10-25; this E2E result does not change the unaudited status or imply mainnet readiness. See [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md) for verification, replay, tamper, and privacy evidence. Mainnet, custody, wallet management, identity, and person-level Sybil resistance are non-goals. See [ERRORS.md](ERRORS.md) for failure handling.
