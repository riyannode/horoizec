# Public QEDIT ZSA Testnet Validation

Date: 2026-10-25
Repository: `riyannode/horoizec`
Branch: `feat/vercel-fullstack`
Baseline HEAD: `d75339365f2af6e7be913e773ad9f057050afe3c`

## Outcome

**PUBLIC_ZSA_E2E_PASS** — a real browser-generated HCP1 proof for a genuine eligible testnet note was accepted by the API; stateless verification, replay protection, tamper rejection, privacy inspection, and insufficient-balance rejection were exercised against public QEDIT ZSA data.

No transaction, commit, push, or deployment was performed. The one-note MVP protocol is unchanged.

## Gate Evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| 1. Cryptographic regressions | PASS | `cargo +1.99.1 fmt --check`, `cargo +1.99.1 check --locked --all-targets`, and `cargo +1.99.1 test --locked --features test-utils --test claim` passed: 18 tests, 0 failures. Adversarial cases use all nine circuit public inputs and mutate only the intended property. The insufficient-balance Rust regression rejects with `NoEligibleNote`. |
| 2. Public network and chain data | PASS | `https://rpc.test-zsa.org` reported `chain=test`, tip height 7740, genesis `f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756`, and NU7 active. Snapshot 7596 hash was `117825b695547d089c056686db855cdb63fadc279a9c2ab39b713eb6f656a457`; its Orchard root was `6eec05f584ea828d325ffd69d4d34b91e85f4db9fe16d6d727a381ecb009f610`. API action reads checked canonical block hashes and root. |
| 3. Real eligible note | PASS | The pinned QEDIT transaction tool's source-published test wallet contained a genuine public note for ZIP 227 AssetId `00009aa99143bb05394cdcaa3c383b295dbcf4251ac0e1a66667c94386cae62d6e828caf741321be05dd01c888966b515ea14ff3376b4593cbf96d8c7826a4059510`. AssetBase and canonical inclusion were validated at snapshot 7596; the note was unspent and met threshold 100. Actual proof acceptance independently demonstrated browser scanner/witness compatibility. No private key, amount, or witness is recorded. |
| 4. Public browser HCP1 E2E | PASS | Horoi's actual frontend and ChatGPT Browser scanned 7,596 blocks using 475 action-range requests (16 blocks per range). The accepted HCP1 proof was 5,640 bytes; browser WASM proving took 115,354 ms on the captured acceptance run. API submit returned HTTP 200. Stateless `/api/v1/proofs/verify` returned HTTP 200 with `valid: true`. Resubmitting the identical request returned HTTP 409 `NULLIFIER_USED`. A one-bit proof mutation returned `valid: false`. Malformed JSON returned 400 `BAD_REQUEST`; invalid AssetId returned 400 `INVALID_ASSET_ID`; future snapshot returned 400 `INVALID_SNAPSHOT`. A second distinct claim domain for the same note produced a distinct alternate nullifier. |
| 5. Privacy and persistence | PASS | Browser Network request body was inspected: keys were `claimId`, `protocolVersion`, `proof`, and `alternateNullifiers` (one value). The exact private key, seed phrase, full viewing key, decrypted note, exact balance, and witness/authentication path were absent. SQLite contained two accepted claims and two consumed nullifiers; a comparison of stored values confirmed that the same note under distinct domains yielded distinct nullifiers. For insufficient balance, the real public action ranges fetched by the browser were replayed from temporary IndexedDB into the original Horoi browser scanner/WASM under a `u64::MAX` threshold; it returned `NoEligibleNote`, with 475 cached ranges, 0 missing ranges, and 475 playback requests. No proof was submitted for this claim. |
| 6. Documentation and final validation | PASS | A narrow report and testing/error/setup docs were updated to match observations. Final command results are listed below. |

## Public chain scan measurements

The successful browser scan used 475 API range requests, 16 blocks per range (last range shorter), all HTTP 200, with approximately 5.0 MB of action response data. The complete scan took about 1,410,512 ms. Per-range API latency was not separately retained. A second full scan for the distinct-domain claim also succeeded; it took about 1,403,824 ms. The captured browser proof phase was about 192,352 ms on the first run and 115,354 ms on the accepted second run. These are browser observations, not native Rust proof timings.

Separately, an earlier bounded RPC diagnostic scanned 7,592 blocks: 15,190 RPC attempts, one successful retry, no exhausted retries, 580.3 seconds, 408,759,053 response bytes, and 133,176 KiB peak RSS. These are diagnostic measurements from that scan and should not be conflated with browser API request counts. No failed range or chain-consistency mismatch occurred in the successful browser scans.

The initial claim-creation frontend request exposed a 30-second Next.js rewrite proxy timeout: the backend took 563,147 ms and persisted the claim, while the frontend proxy reset the response. The installed Next.js 16.4 runtime confirmed its rewrite proxy timeout default is 30,000 ms. `frontend/next.config.ts` now sets `experimental.proxyTimeout` to 900,000 ms, exceeding the measured request. This avoids the observed response reset without changing the API or chain-validation logic.

## Implementation changes

- Corrected Halo2 adversarial public-input vectors to include all nine circuit inputs and isolate each intended invalid property.
- Added Rust insufficient-balance regression coverage.
- Mapped unknown API exceptions to `INTERNAL_ERROR` / HTTP 500 and malformed JSON to `BAD_REQUEST` / HTTP 400; aligned verifier/prover unavailable terminology in docs.
- Pinned the ZSA testnet genesis identity and retained canonical block/root checks for public actions.
- Added bounded retries for transient public action-range failures while preserving in-order and canonical-chain validation.
- Set the frontend rewrite proxy timeout from the measured 30-second failure to 15 minutes.

## Validation commands

Passed during this task:

- `cargo +1.99.1 fmt --check`
- `cargo +1.99.1 check --locked --all-targets`
- `cargo +1.99.1 test --locked --features test-utils --test claim` — 18 passed, 0 failed
- `bun test server.test.ts` — 2 tests passed, 4 assertions
- Backend TypeScript compiler via `bun ./node_modules/typescript/bin/tsc --noEmit`
- Backend `bun run build`
- Frontend TypeScript compiler via `bun ./node_modules/typescript/bin/tsc --noEmit`
- Frontend `bun run check` — passed after the proxy timeout configuration change
- Frontend `bun run build` — passed after the proxy timeout configuration change
- `git diff --check` — passed after documentation updates

The backend `bun run check` wrapper failed in WSL because it resolved a missing Windows `bunx.exe`; this is a failed check, not a pass. The direct backend TypeScript compiler command and backend `bun run build` passed. No build or test substitutes for the public browser E2E evidence above.

## Cleanup

After final validation, task-owned backend/frontend processes and temporary scan resources were stopped and removed. Ports 3000, 8787, and 8788 were verified closed; temporary scan directories and the SQLite database were removed. No unrelated process was stopped.
