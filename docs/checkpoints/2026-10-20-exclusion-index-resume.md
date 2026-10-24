# Horoi resume checkpoint - 2026-10-20

## Pause state

The user explicitly requested: stop now, save the latest progress, clean up, and resume only after they say "lanjut". Do not continue implementation until that instruction arrives.

The requested goal objective was read from `C:\Users\ACER\.codex\attachments\f1d32249-632b-4943-b635-c012d9f076c1\goal-objective.md`. Its task is to implement Horoi end-to-end against `HOROI_PRD.txt` and root `HOROI_AGENTS.md`; the objective requires WSL/Linux-only Horoi work, dependency/source verification, implementation, validation, docs, release-candidate review, then commit/push only after browser validation passes. No commit or push has occurred.

## Checkout

- WSL repo: `/home/acer/projects/horoi`
- Branch: `feat/vercel-fullstack`
- HEAD at pause: `93c978f104bf2d820fcf072bea0aa3dc3e81344c`
- The working tree is heavily changed by the broader Horoi migration plus this work. Preserve it as-is; do not reset/revert or treat the large diff as disposable.
- Root `HOROI_AGENTS.md` is untracked. Main Horoi implementation currently resides in `backend/`, `frontend/`, and `docs/`.

## Work completed in this turn

- Added Rust Orchard-depth-32 exclusion interval tree and local witness verification in `backend/rust/src/exclusion.rs`; exported it from the library.
- Added direct `incrementalmerkletree = "=0.8.2"` dependency.
- Added verifier JSON operation `exclusionRoot` and Bun wrapper `deriveExclusionRoot`.
- Implemented `resolveSnapshot` in `backend/zcash.ts`: fetches and validates the target testnet block/Orchard root, traverses public block data by hash with parent-link checks, extracts public Orchard action nullifiers, derives the exclusion root locally, rechecks the selected block hash, caches by network/height/hash, and retries transient RPC transport/body failures.
- Added Rust integration cases in the required single protocol test file for ordering/deduplication, membership/exclusion behavior, tampering, empty and boundary inputs.
- Updated crypto/setup/testing/API/error docs and frontend copy to distinguish a derived public-data root from an actual private-note ownership and unspent proof. Claim proving remains fail-closed.
- Full implementation details and current working tree are available directly in the checkout; no commit was made.

## Validation already completed

- `cargo +1.99.1 fmt --check` passed.
- `cargo +1.99.1 check --all-targets` passed.
- `cargo +1.99.1 test --features test-utils` passed: 13/13, including the exclusion tests and proof test.
- Backend Bun check/build passed.
- Frontend Bun check/production build passed.
- `git diff --check` passed.
- Changed-source whitespace/final-newline scan and targeted key/token pattern scan passed.
- WSL environment observed: Linux WSL2; repo path `/home/acer/projects/horoi`; Bun `/home/acer/.bun/bin/bun`; Cargo/Rust tools under `/home/acer/.cargo/bin`; Rust `1.99.1 (58cf8f9c3 2026-10-13)`.

## Browser and live testnet evidence

- ChatGPT in-app browser exercised the actual local UI/API against QEDIT ZSA testnet at height 100. Creating a snapshot statement returned HTTP 201; SQLite readback showed:
  - network `zsa-testnet`, height `100`
  - commitment root `0eee62d7c89a13dc1a350c1aff0f1eee29c75bfb00ff7f3d0a6802193e724702`
  - derived exclusion root `1b3198b753139528d970f912296b98d818554abf6348bbefbd8f344d08dc3d16`
- Detail UI explicitly showed that this build cannot prove a note was unspent at the snapshot and claim proving is disabled. This is partial browser evidence, not full MVP acceptance.
- Temporary E2E SQLite DB and WAL/SHM files were removed; the agent-created browser tab was closed. Backend/frontend preview sessions were stopped. At cleanup, no scan/verifier process remained and ports 3000/8787 had no listeners.
- An earlier full scan attempt to height 6799 ended with an RPC response-body ECONNRESET. A retry-enabled full scan was then started; the latest observed elapsed log was 354 seconds. The user requested stopping during that scan. It returned no root; do not claim full-height completion. The exact Bun session was already gone when checked, and process inspection found no matching Bun scanner or `horoi-verifier`.

## Remaining work / acceptance gap

The exclusion tree is only a primitive. The circuit does not yet derive the ordinary Orchard nullifier from the same private note and bind it to the complement interval witness. Missing work includes:
1. Circuit constraints for note-derived nullifier, interval bounds without field wrap, interval leaf, and authentication path to the public exclusion root.
2. Browser/WASM witness path and public statement integration without uploading a note/nullifier.
3. Behavior tests for circuit binding and verification, replay/idempotency atomicity, and full acceptance checks.
4. Complete review of each PRD criterion and repeat release checks after browser acceptance.
5. Decide whether to rerun the expensive height-6799 scan; prior retry was interrupted and yielded no result.

The Orchard balance-proof draft describes the nullifier-exclusion construction and still marks alternate-nullifier security analysis as TODO: https://github.com/zcash/zips/blob/main/zips/draft-str4d-orchard-balance-proof.md. Do not claim the draft closes that security question.

## Resume procedure

When the user says "lanjut", first re-read the goal objective, `HOROI_PRD.txt`, and root `HOROI_AGENTS.md`, inspect the live WSL branch/status and current diffs, and confirm there are no task-owned processes before continuing. Resume from this checkpoint, preserve all current changes, and do not commit/push until the objective's browser and acceptance requirements are actually satisfied.

## Follow-up after explicit resume - 2026-10-21

The user resumed with "lanjut". Work continued in WSL only. The earlier pause instructions above describe the historical 2026-10-20 state; do not use their incomplete-circuit/browser findings as the current implementation state.

### Current implementation changes

- The Rust circuit now derives the standard Orchard nullifier from the private note and binds its exclusion interval to the public exclusion root. HCP2 carries nine public inputs; proof protocol/domain are version 2.
- The exclusion tree follows the experimental Valar balance-proof draft. Host verification rejects low=0 and positions outside the 29-bit tree; the circuit also enforces low != 0 to prevent using the canonical padded empty leaf.
- Browser proving now accepts the canonical 66-byte ZIP 227 AssetId. The previous 32-byte decoder rejected every valid AssetId before WASM; the UI decoder was corrected while the remaining roots/keys retain 32-byte checks.
- `/proofs/verify` and `/claims/:id/submit` now re-resolve the snapshot against the active configured chain after cryptographic verification, compare both roots, reject stale roots with `SNAPSHOT_STALE` (409), and recheck expiry before returning/consuming a nullifier.
- Home/create/verify copy now describes the available experimental single-note proof and the missing wallet scanner accurately. API/error docs describe snapshot revalidation and the stable error model.
- The wrong-FVK test now asserts constructor-level witness rejection, which is the intended fail-closed behavior.

### Validation after resume

- `cargo +1.99.1 fmt --check` and `cargo +1.99.1 check --locked --all-targets` passed.
- `cargo +1.99.1 test --locked --features test-utils --test claim` passed: 13/13. The first run exposed the stale wrong-FVK test expectation; after changing it to assert constructor rejection, the complete rerun passed.
- Backend `bun run check` and `bun run build` passed. Frontend `bun run check` and `bun run build` passed after the AssetId and copy changes.
- Release WASM build and `wasm-bindgen 0.2.129` generation passed. ChatGPT Browser loaded `/claim.js`, initialized its WASM module, and accepted a valid 66-byte ZIP 227 AssetId through `derive_zsa_asset_base` (returned 32-byte AssetBase). This validates the WASM ABI length; it does not prove an eligible note.
- ChatGPT Browser smoke checked `/`, `/claims`, `/claims/[id]`, `/create`, and `/verify`; not-found/error states rendered. The verifier request payload contained only claim ID, protocol version, proof, and alternate nullifier.
- SQLite replay check accepted the first `(claim_id, nullifier)` insert and rejected the duplicate.
- `git diff --check` passed at the last review. No commit or push was made.

### Remaining blockers / current cleanup

- Full eligible-holder browser E2E remains unverified: the frontend still requires the holder to supply a local note/exclusion witness JSON and spending key; there is no browser wallet scanner. No actual eligible testnet note/proof fixture is available.
- Stale-root rejection is source-implemented but has not been exercised against a live node or reset/reorg. WSL has no Zebra/Zcash RPC listener or node process, so creation and active-chain revalidation cannot be runtime-verified here.
- `HOROI_MEASURE_PROOF=1` targeted proof test passed: setup+prove 165,667 ms, proof bytes 5,248 excluding the 392-byte HCP2 header (5,640 bytes total). Documented in `docs/CRYPTO.md`.
- Preview processes and their temporary SQLite file were stopped/removed after browser smoke. No listener remains on ports 3000, 8787, or 18232.
- Checkout is still `/home/acer/projects/horoi`, branch `feat/vercel-fullstack`, HEAD `93c978f104bf2d820fcf072bea0aa3dc3e81344c`. Preserve the extensive dirty migration; do not reset it. Do not commit/push while MVP acceptance gaps remain.


## Follow-up after explicit resume - 2026-10-21 (scanner and issuance event stream)

The user then explicitly said "lanjut" and work continued. The latest instruction is now to stop, clean up, save progress, and wait for another explicit "lanjut". Do not resume coding or validation until then.

### Latest implementation changes preserved in the dirty worktree

- backend/rust/src/zsa.rs now skips spent eligible note candidates and continues to later candidates. backend/rust/tests/claim.rs adds coverage for selecting the next eligible note and rejecting when all candidates are spent.
- Regtest identity validation in backend/zcash.ts accepts Zebra chain "test" only with the pinned QEDIT regtest genesis hash; testnet rejects that genesis. docs/SETUP.md documents the behavior.
- Rust verifier now parses raw QEDIT transactions with the pinned QEDIT librustzcash source and returns public issuance commitments. backend/zcash.ts and the frontend stream Orchard actions plus issuance commitment events in transaction order; WASM scanner adds those commitments to the frontier/witness and uses tagged event records.
- Rust dependencies/patches and .cargo/config.toml pin the matching QEDIT Orchard/librustzcash sources and enable zcash_unstable="nu7". Cargo.lock is updated.
- Frontend WASM assets in frontend/public/ were rebuilt and are part of the working changes. User-visible error handling preserves non-Error JS/WASM error values as strings.

### Latest validation and browser finding

- cargo +1.99.1 check --all-targets passed.
- cargo +1.99.1 test --locked --features test-utils --test claim passed: 16/16.
- cargo +1.99.1 build --locked --release --bin horoi-verifier passed.
- Backend and frontend bun run check && bun run build passed.
- Release WASM build and wasm-bindgen generation passed.
- Local regtest API returned HTTP 200 for heights 1-2, with transaction/action/issuance arrays. A temporary Rust calculation found root b862cd2ace808a9ae79f96a9bad04dcc3bb30f8af224920ad46d323882555527, matching the expected claim root. Browser root mismatch was resolved after restarting the frontend with current assets.
- The latest browser run now fails at NoEligibleNote: the public commitments are in the tree, but the scanner does not yet receive the public issuance note fields needed to reconstruct and match the issued note to the local viewing key. This is the precise next implementation blocker. Do not claim end-to-end browser acceptance.
- On resume, inspect current code and derive a compact tagged issuance-note record containing CMX, asset base, recipient raw bytes, value, rho, and rseed from the pinned QEDIT transaction parser. In WASM reconstruct the Orchard Note locally, validate its commitment/ownership/asset/value and derive nullifier/exclusion witness before selecting it. Keep note/key/witness in browser; this proposed layout/approach was investigated but not implemented or validated.

### Pause cleanup - 2026-10-21

- Stopped task-owned Zebra, backend, frontend, and key-bridge sessions. Verified no listeners on 127.0.0.1 ports 3000, 8787, 8788, or 18232.
- Removed task-owned regtest/wallet SQLite files, fixture key and asset id, temporary regtest config/logs, public snapshot/action/root JSON fixtures, temporary pkgconf helper, and temporary Rust inspection examples. Kept extracted /tmp/horoi-build-deps and /tmp/horoi-wasm-toolchain for efficient resume; did not remove shared Zebra cache or pre-existing source checkouts.
- Restored only the task-modified src/commands/test_issue_one.rs in /tmp/horoi-source-qedit-tx-tool; its remaining src/components/transactions.rs modification was preserved as unrelated/pre-existing.
- Repo remains /home/acer/projects/horoi, branch feat/vercel-fullstack, HEAD 93c978f104bf2d820fcf072bea0aa3dc3e81344c, with its extensive dirty migration and implementation changes preserved. No commit/push/deploy.
## Follow-up after explicit resume - 2026-10-22 (issuance-note browser E2E)

The user explicitly resumed the goal with "lanjut". The previous pause cleanup section is historical and the following work supersedes its `NoEligibleNote` result.

### Implementation and validation

- `backend/rust/src/bin/horoi-verifier.rs` now decodes public issuance notes from pinned QEDIT raw transactions and returns CMX, asset base, recipient, value, rho, and rseed.
- `backend/zcash.ts` validates those fields; the browser packs them into tagged public records. `backend/rust/src/zsa.rs` reconstructs and validates each note locally, derives its nullifier and exclusion witness in-browser, and never sends note/key/witness material to the backend.
- Added a Rust regression covering browser record reconstruction, proof generation/verification, and tampered CMX rejection. Rust claim integration suite passed 17/17; `cargo +1.99.1 fmt --check`, `cargo +1.99.1 check --locked --all-targets`, native release verifier build, and release WASM build/bindgen passed. Backend and frontend `bun run check && bun run build` passed.
- ChatGPT Browser against local WSL preview created two statements on Zebra regtest, scanned the issued note in WASM, and received HTTP 200 on proof submission. Duplicate submission returned HTTP 409. Public verifier returned `VALID` for the proof bundle and `INVALID` after changing a proof byte. Backend request logs show claim/snapshot, submit, and verifier endpoints only; the spending key was not sent to the API.
- The test used pinned QEDIT Zebra regtest at height 1 and a disposable local fixture key. This is local experimental flow evidence; public ZSA testnet acceptance remains unverified. The prior height-100 scan completed; the full-height scan ended with an RPC connection reset and remains incomplete.
- Temporary browser autofill/fixture route and proof-bundle helper code were reverted. No source changes for test harness remain.

### Current state and cleanup

- Repo: `/home/acer/projects/horoi`, branch `feat/vercel-fullstack`, HEAD `93c978f104bf2d820fcf072bea0aa3dc3e81344c`. The existing broad dirty migration is preserved. No commit, push, or deploy was made.
- Rust formatting/check, backend check/build, frontend check/build, and `git diff --check` passed after removing the temporary browser harness.
- Task-owned Zebra, backend, and frontend sessions were stopped. Confirmed no listeners on ports 3000, 8787, 8788, or 18232. Removed the disposable QEDIT/Zebra source builds, local proving parameters, regtest/wallet SQLite files, key/asset fixtures, configs, and temporary test-harness backups. The IAB test tab is turn-scoped; its close attempt was blocked by the browser URL policy and the tab will be cleared at turn end.
- No public testnet run or release acceptance is claimed.

## Follow-up after explicit resume - 2026-10-22 (protocol v1 alignment and docs)

- Read the goal objective and root HOROI_AGENTS.md, then inspected the live WSL checkout. Repository remains `/home/acer/projects/horoi`, branch `feat/vercel-fullstack`, HEAD `93c978f104bf2d820fcf072bea0aa3dc3e81344c`. The broad dirty migration remains preserved; no commit, push, deploy, or merge.
- Compared `docs/PRD.txt` byte-for-byte with the supplied `HOROI_PRD.txt`; they match. The tracked source top-level directories are `backend/`, `frontend/`, and `docs/`. Ignored/pre-existing local build/cache directories remain untouched.
- Aligned the initial implementation to PRD protocol version 1: Rust claim encoding and domain label, HCP1 proof bundle marker/parser, backend schema/database version, and public verify form. Updated the stable claim ID/domain vectors and unsupported-bundle test in the single Rust integration test file. Updated API/crypto/setup docs to match.
- Fixed create-form validation so invalid AssetIds reach the API and show the documented `INVALID_ASSET_ID` message; changed the home action label to “Browse Claims”. The spending-key field remains read from a local React ref and has no HTML `name`.
- Added computed claim status (active/expired) to SQLite records and claim list cards; added the valid statement fields to proof verification responses/UI. Added an NU7-active check to the configured-network gate.
- Reconciled Architecture, API, Crypto, Errors, Security, Setup, Testing, Hackathon, References, and README docs with the current local-regtest E2E evidence and the public-testnet limitation. Required exact ChatGPT Browser testing-policy sentence is present. External reference URLs checked with HTTP 200; local Markdown links resolve.
- Validation: `bun install --frozen-lockfile` passed in backend and frontend; backend `bun run check && bun run build` passed; frontend `bun run check && bun run build` passed after the final UI edit; Rust `cargo +1.99.1 fmt --check && cargo +1.99.1 check --locked --all-targets` passed; the one Rust integration target passed 17/17 after protocol v1 alignment; native release verifier build passed; release WASM build and wasm-bindgen generation passed using extracted Clang 18 path. SQLite in-memory smoke confirmed active/expired status query behavior. Current protocol-v1 native measurement: setup+prove 45,464 ms, proof bytes 5,248, total HCP1 bundle 5,640 bytes.
- 2026-10-24 ChatGPT Browser validation used QED-it/zcash_tx_tool `45413e8a9159bfeb6a9ca829c72f315a49266bc6` and QED-it/zebra `8c9c93fdd91b89fab387ec68362a93b2baca7bab`. Zebra regtest reached height 1 with NU7 active and the pinned QEDIT genesis. The browser created a claim from the issued AssetId and public snapshot, displayed it active, generated and submitted the HCP1 proof, and showed note-level replay protection. Replaying the same note returned HTTP 409 and the duplicate-use message. `/verify` showed VALID for the accepted proof and INVALID after one proof byte was changed. Invalid AssetId creation showed `The AssetId is invalid.` A captured local submit payload contained only claimId, protocolVersion, proof, and alternateNullifiers; it did not contain the fixture spending key. The capture hook and payload were removed after inspection.
- PRD wrong-AssetId and wrong-snapshot negative cases were also checked against the same HCP1 proof using the native verifier. A distinct, valid AssetId with the same snapshot and the original AssetId with snapshot height changed each returned `INVALID_PROOF`.
- Final checks on 2026-10-24: backend `bun run check && bun run build` passed; frontend `bun run check && bun run build` passed; Rust `cargo +1.99.1 fmt --check`, `cargo +1.99.1 check --locked --all-targets`, and `cargo +1.99.1 test --locked --test claim` passed (17/17). Current HCP1 measurement remains setup+prove 45,464 ms, proof 5,248 bytes, total HCP1 bundle 5,640 bytes.
- Public ZSA testnet proof acceptance remains unverified. The implementation and UI remain explicitly labeled testnet, experimental, and unaudited. No deploy or merge was performed.
- Task-owned Zebra, API, and frontend processes were stopped; ports 3000, 8787, 8788, and 18232 are clear. Disposable `/tmp/horoi-e2e-2026-10-24` (including the fixture key and captured proof) and `/tmp/horoi-build-deps` were removed. The acceptance screenshot is saved outside the repo at `C:\Users\ACER\.codex\visualizations\2026\10\20\01a1594b-8910-7882-9b24-e06302c4057b\horoi-hcp1-accepted.png`.

### Release review state

1. Browser proof and PRD A-L validation are complete. Final diff, tracked-secret scan, clean worktree, and `git diff --check` passed. The implementation is committed locally as `8d41c899156a69a9a972cdc07d764feb14665468` on `feat/vercel-fullstack`.
2. `git push origin feat/vercel-fullstack` was attempted after the audit and returned `Repository not found` for the configured `https://github.com/riyannode/horoi.git` remote. The connected `riyannode` account search does not expose a repository named `horoi`; `riyannode/horoiweb` is a different desktop-agent product, and `reflecterlabs/horoi` is an unrelated CDP protocol repository with no push permission. No remote ref was updated. Do not change the remote URL or push to a different destination without user authorization; resume the push after the correct repository/access is restored.
