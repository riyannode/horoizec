# Setup and dependency proof

## Docker Judge Quickstart

Requirements: Linux-capable Docker Engine and Docker Compose v2. From a fresh checkout:

```bash
git clone https://github.com/riyannode/horoizec.git
cd horoizec
docker compose up --build
```

Then open [http://localhost:3000/demo](http://localhost:3000/demo). This is the zero-credential judge mode: no `.env`, wallet, QEDIT RPC, public scan, payment, or transaction. The build uses pinned Rust 1.99.1 and Bun 1.4.3 base images plus `Cargo.lock` and each Bun lockfile. It builds the native verifier and Next.js production server from source; it does not use prebuilt WSL artifacts. Docker's x86_64/Linux build path was exercised in this task; arm64 is not yet acceptance-tested.

The first startup derives and verifies the pinned HCP1 fixture with Rust before backend health is declared. SQLite persists in the `horoi-judge_horoi_data` volume. To reset only the judge project and its replay state, use `docker compose down -v --remove-orphans`. See [DEMO.md](DEMO.md) for scenario and provenance details and [DEPLOYMENT.md](DEPLOYMENT.md) for the isolated public-Docker profile.

## Environment

Implementation and source validation ran in WSL2 on Ubuntu 24.04. The repository is /home/acer/projects/horoi.

The WSL environment has Bun 1.4.3 and Rust 1.99.1 available. Sudo access is unavailable, so no system packages were installed. The QEDIT transaction-tool checks used extracted Ubuntu packages under /tmp/horoi-build-deps. The browser WASM build used an extracted Ubuntu Clang 18 toolchain under /tmp/horoi-wasm-toolchain.

## Current WASM metadata build

The browser target uses Rust 1.99.1, wasm32-unknown-unknown, wasm-bindgen and wasm-bindgen-cli 0.2.129, and Clang 18 for the pinned secp256k1 C dependency. Orchard multicore is disabled because the selected browser target has no atomics. Install the target, CLI, and compiler in WSL, then run from the repository root:

    sudo apt-get update
    sudo apt-get install -y clang-18
    rustup target add --toolchain 1.99.1 wasm32-unknown-unknown
    cargo +1.99.1 install wasm-bindgen-cli --version 0.2.129 --locked
    CC_wasm32_unknown_unknown=clang cargo +1.99.1 build --locked --release --target wasm32-unknown-unknown --manifest-path backend/rust/Cargo.toml
    wasm-bindgen --target web --out-dir frontend/public --out-name claim backend/rust/target/wasm32-unknown-unknown/release/horoi_claim.wasm
    cp frontend/public/claim_bg.wasm frontend/public/claim.wasm

The generated module exports claim ID/domain, AssetBase derivation, public-input encoding, spend authorization, manual-witness proving, and `scan_and_prove_single_note_claim_wasm`. The scan function accepts an ordered stream of public Orchard actions and issuance-note records plus a local 32-byte spending key; WASM checks both claim roots, scans ZSA outputs, builds both witnesses, and returns an HCP1 bundle for one eligible note. Issuance records carry public commitment, asset base, recipient, value, rho, and rseed fields so WASM can reconstruct and verify each note locally. Tagged records preserve consensus tree order. The proof does not aggregate up to four notes or support split notes. The measured native setup-plus-proof time and proof size are recorded in [CRYPTO.md](CRYPTO.md). The generated `claim.js` loader uses `claim_bg.wasm`; `claim.wasm` is the required named artifact copy.

The `/claims/[id]` form accepts a 32-byte QEDIT spending-key encoding. It downloads compact public ranges in batches of at most 16 blocks; vanilla Orchard ciphertexts use 52 bytes and OrchardZSA ciphertexts use 84 bytes. The backend parses each raw transaction with the pinned QEDIT decoder because Zebra's decoded block JSON omits issuance notes. Public issuance note fields are streamed in transaction order so WASM can reconstruct the note, verify its commitment and asset, match its recipient to the local viewing key, and construct the Merkle/exclusion witnesses locally. The key, decrypted notes, and witnesses are not sent to the backend.

Build the native line-oriented verifier bridge with:

    cargo +1.99.1 build --locked --release --bin horoi-verifier

The backend can keep `backend/rust/target/release/horoi-verifier` alive and
exchange one JSON request/response per line. The process loads the deterministic
`k=13` proving/verifying key once; its first use includes setup cost. See
[API.md](API.md) for the request format.

## Pinned ZSA source revisions

The QEDIT transaction tool was inspected at revision 45413e8a9159bfeb6a9ca829c72f315a49266bc6. Its lockfile pins these relevant git dependencies:

| Dependency | Revision |
| --- | --- |
| QED-it/orchard | cf801a5d6701bc128e21678ba0034564af4a2aca |
| QED-it/librustzcash | c5c232db9c54eeb8bc1d0f4dc1b8a0e40f981bb0 |
| QED-it/sapling-crypto | e785faaa5eaf67bd2cb328fdd82a345df44e5754 |
| QED-it/halo2 | ef3d0ba2e9a513658f8d3d00294ddebd92cc649e |
| QED-it/zcash_spec | d5e84264d2ad0646b587a837f4e2424ca64d3a05 |
| zcash/sinsemilla | aabb707e862bc3d7b803c77d14e5a771bcee3e8c |
| zcash/zcash_note_encryption | 9f7e93d42cef839d02b9d75918117941d453f8cb |

The transaction tool's CI pins QED-it Zebra at 8c9c93fdd91b89fab387ec68362a93b2baca7bab. The inspected Cachet reference was 87cec756c1f3dd316250024137ba71f33db53bd4.

The QEDIT Orchard source checked out separately for inspection was 870112d4e92af57dc6cbdd78c77175a74c7634b0; implementation should depend on the exact transaction-tool lockfile revision above, not this moving checkout head.

## Reproduced local ZSA flow

The following were successfully completed from Linux source checkouts:

- cargo +stable check --locked --all-targets in the pinned QEDIT transaction-tool source.
- cargo +stable build --locked --release -p zcash_tx_tool in the same source.
- cargo +stable check --locked -p zebrad and cargo +stable build --locked -p zebrad at the transaction-tool CI Zebra revision.
- A fresh single-node QEDIT Zebra regtest started with RPC bound to 127.0.0.1:18232; initial block height read back as zero.
- The QEDIT transaction tool's test-issue-one flow issued a ZSA on that local regtest, mined it, and read the resulting wallet balance back.

The task-owned regtest process was stopped after the proof. The transaction and wallet state were local and ephemeral. This does not establish a public testnet or mainnet ZSA integration.

For a clean setup, use the pinned tool versions and commands in this section. The repository includes independent `backend/bun.lock` and `frontend/bun.lock` files plus `backend/rust/Cargo.lock`; install Bun dependencies with `bun install --frozen-lockfile` from each application directory. The recorded Rust/WASM build used Rust 1.99.1, the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` 0.2.129, and Clang 18. The checks and builds passed in the existing WSL2 Ubuntu 24.04 environment with those tools available. A fresh base-image provisioning run was not independently performed; the earlier QEDIT transaction-tool checks used task-local extracted packages under `/tmp`.

## Claim-circuit implementation boundary

At the pinned Orchard revision, unstable-voting-circuits exposes selected note, key, and gadget APIs. The Action circuit's Witnesses fields and its outer Circuit witness container remain crate-private. The stock Action proof includes the ordinary Orchard nullifier in its public inputs, which conflicts with Horoi's privacy statement if used directly.

The upstream Orchard balance-proof draft describes an alternate-nullifier sketch, but marks its collision/linkability security analysis TODO. It also presents a per-note claim and leaves multi-note aggregation as an open question. It does not provide the ZSA note-commitment circuit, threshold proof, snapshot/exclusion format, or a reviewed implementation.

The open Valar Group draft PR #1199 provides a concrete gap tree and alternate-nullifier construction, but it is not an accepted ZIP. Horoi's experimental circuit follows its public proposal and pins the exact draft commit in `docs/CRYPTO.md`. This is not a security review or standards approval.

## Horoi Rust crate git dependencies

The Rust crate lockfile currently uses these exact source revisions:

| Dependency | Revision |
| --- | --- |
| QED-it/orchard | cf801a5d6701bc128e21678ba0034564af4a2aca |
| QED-it/halo2 | ef3d0ba2e9a513658f8d3d00294ddebd92cc649e |
| QED-it/zcash_spec | d5e84264d2ad0646b587a837f4e2424ca64d3a05 |
| zcash/sinsemilla | aabb707e862bc3d7b803c77d14e5a771bcee3e8c |
| zcash/zcash_note_encryption | 9f7e93d42cef839d02b9d75918117941d453f8cb |

Horoi pins QEDIT librustzcash directly for its native transaction decoder. The decoder reads each canonical transaction and extracts public issuance-note fields, which Zebra's decoded block JSON omits. Its Orchard dependency is patched to Horoi's local copy of the same pinned revision so the native decoder and browser proof path use identical commitment code. `backend/rust/.cargo/config.toml` enables the upstream `nu7` cfg required by this QEDIT source set.

The Orchard package used by Horoi is a local copy of QED-it/orchard revision cf801a5d6701bc128e21678ba0034564af4a2aca at backend/rust/vendor/orchard. The local changes expose the three fields in ZsaNoteCommitParams so Horoi can call the existing ZSA note-commit gadget, expose CommitIvk's Sinsemilla interface to bind the note recipient, expose the existing split-note constructor for protocol tests, add psi_nf as the same selected-randomness expression used by QEDIT Note::nullifier, and expose the Zatoshi-asset witness helper needed to configure the note-commitment circuit. These changes do not alter Orchard commitment or nullifier behavior. The package manifest metadata records the upstream source revision; the Horoi lockfile resolves this patched package as a local path. Upstream tests, book, and CI metadata are not vendored.

## Current implementation and environment boundary

The backend and frontend are under `backend/` and `frontend/`, with independent Bun lockfiles. Copy `backend/.env.example` to `backend/.env` for the local QEDIT Zebra regtest. Supported variables are `HOST`, `PORT`, `NETWORK_ID` (`zebra-regtest` or `zsa-testnet`), `ZCASH_RPC_URL`, optional `ZCASH_RPC_USER` and `ZCASH_RPC_PASSWORD`, `DATABASE_PATH`, and `VERIFIER_PATH`. Defaults bind the API to 127.0.0.1:8787 and RPC to 127.0.0.1:18232; do not point this prototype at mainnet. The backend requires NU7 status active before ZSA routes proceed. Zebra reports BIP70 `chain: "test"` for both testnet and regtest, so Horoi checks the genesis hash for each configured network: QEDIT regtest (`029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327`) and the QEDIT public ZSA testnet endpoint (`rpc.test-zsa.org`, `f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756`, observed 2026-10-24). A testnet reset or endpoint change fails closed until its ZSA identity is reverified and the expected genesis hash is updated.

Start the API in WSL from `backend/` with `bun run start`, and the UI from `frontend/` with `bun run dev`. The UI is available at http://127.0.0.1:3000. The API defaults to http://127.0.0.1:8787.

The QEDIT testnet `z_gettreestate` response exposes the Orchard commitment root, not a precomputed standard-nullifier exclusion root. Horoi derives the latter by reading canonical block hashes and verbosity-2 block transactions from height 1 through the selected snapshot, collecting public Orchard action nullifiers, and building the deterministic complement tree in the Rust verifier. The browser feed uses decoded Orchard actions plus public issuance-note fields parsed from each transaction's raw hex; it preserves transaction order so the browser can reconstruct the same commitment tree. It checks block heights, block hashes, parent links, and the selected block hash again before returning the snapshot. The scan cache is process-local; a restarted backend rebuilds it. Public nullifiers are sent only to the local verifier process, and no note or private nullifier is sent for witness retrieval.

The updated Rust circuit binds its computed standard nullifier to a gap witness and public exclusion root. On 2026-10-22, the local browser scanner reconstructed an issued note from public transaction fields, generated a proof in WASM, and received acceptance from the local verifier. On 2026-10-25, ChatGPT Browser generated a real HCP1 proof from a genuine note in public QEDIT ZSA testnet snapshot 7596 and Horoi accepted it. Stateless verification returned `valid: true`, identical replay returned HTTP 409 `NULLIFIER_USED`, and a tampered proof returned `valid: false`. Browser Network inspection confirmed private wallet and witness data stayed client-side. The separate local-regtest result remains fixture evidence only; the public-testnet evidence and scan measurements are documented in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).

For a fresh install, run `bun install --frozen-lockfile` from both `backend/` and `frontend/`. Build the Rust verifier with `cargo +1.99.1 build --locked --release --bin horoi-verifier`; start the API with `bun run start` from `backend/` and the UI with `bun run dev` from `frontend/`. Configure the frontend API path through the same-origin Next.js proxy; no API secret is exposed to the browser.
