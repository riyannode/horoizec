# Cryptographic protocol status

## Public statement

Protocol version 1 binds network ID, ZIP 227 v0 AssetId bytes, positive u64 threshold, u32 snapshot height, Orchard commitment root, deterministic public-nullifier exclusion root, optional expiry, and a random 32-byte creator nonce. Rust canonically encodes these fields, derives a 32-byte BLAKE2b claim ID with personalization HoroiClaimIDv1__, and derives a separately domain-separated Pallas field claim domain. TypeScript does not reproduce these operations.

The MVP uses protocol version 1 as specified by the PRD. The circuit and statement include the authenticated exclusion root and standard-nullifier non-membership relation. HCP1 is the serialized proof-bundle marker for this initial release; any breaking change to the statement, public inputs, nullifier encoding, or bundle format requires a protocol version bump.

## Private witness and relation

The browser witness contains local spending-key material, one normal Orchard ZSA note and its value, recipient key, commitment-tree path, ordinary nullifier, exclusion-gap witness, and randomized spend authorization material. The circuit binds note commitment membership and AssetBase to the public roots, proves the note value meets the threshold, derives the ordinary nullifier inside the circuit, proves it absent from the exclusion set, derives an alternate nullifier from the note nullifier key, claim domain, and ordinary nullifier, and verifies claim-specific spend authorization. WASM does not return witness fields.

HCP1 carries nine circuit public fields, randomized spend key, claim-specific SpendAuth signature, and Halo2 proof. The native verifier checks the serialized public statement, signature, and circuit proof against the stored claim. A valid result proves one normal note against the encoded threshold and snapshot roots. It does not prove aggregate balance across notes, support split notes, or establish person-level uniqueness.

## Snapshot and AssetId binding

Rust validates ZIP 227 v0 AssetIds and derives the QEDIT Orchard AssetBase. The backend obtains the Orchard commitment root from canonical selected Zebra chain state. It scans public standard nullifiers by canonical block hash, builds a deterministic complement-gap tree with the Rust verifier, and binds the root to the claim. Browser ranges are checked against chain heights, hashes, and parent links; WASM verifies both roots while building local witnesses. Verification re-resolves both roots and rejects a changed or reset snapshot.

## Replay and domain separation

The alternate-nullifier relation follows the open Valar Group draft at commit 6d7d72bf80e8eb6e5260923df43a6ca4c3e86c64. The API stores an accepted alternate nullifier under (claim ID, nullifier) with an atomic unique-key insert. The same contributing note cannot be reused in the same claim domain after acceptance. A different claim domain derives a different alternate-nullifier output according to this relation. This is note-level replay protection, not one-person or one-wallet uniqueness. The proposal is not an accepted ZIP and its security analysis remains incomplete.

## Assumptions and limitations

The proof supports one normal note only. No split-note or up-to-four-note aggregation is implemented. Security depends on pinned QEDIT Orchard/Zebra behavior, correctness of the public exclusion-tree derivation, Halo2 and Orchard assumptions, and the unaccepted alternate-nullifier proposal. The implementation is experimental and unaudited.

## Browser WASM and measurement

WASM exports claim/domain and AssetBase derivation, public-input encoding, spend authorization, manual-witness proving, and scan_and_prove_single_note_claim_wasm. It reconstructs issuance notes from public transaction fields, checks commitments and assets, decrypts outputs locally, and constructs both witnesses. On 2026-10-22, local QEDIT Zebra regtest browser E2E created and verified an eligible issued note, rejected replay with HTTP 409, returned VALID for the original bundle, and INVALID for a tampered bundle. This is not public testnet acceptance.

On 2026-10-22, the native synthetic-note measurement on protocol v1 recorded 45,464 ms for setup plus proving, a 5,248-byte proof, and 5,640 bytes total with the 392-byte HCP1 header. The measurement command, run from backend/rust, was HOROI_MEASURE_PROOF=1 cargo +1.99.1 test --locked --features test-utils --test claim orchard_note_alternate_nullifier_uses_the_note_and_domain -- --nocapture. This is not browser proving latency. The product exposes one-note proving; four-note aggregation was not implemented.
