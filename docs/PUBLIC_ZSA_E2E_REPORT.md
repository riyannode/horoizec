# Public QEDIT ZSA Testnet Validation

Date: 2026-10-25
Repository: `riyannode/horoizec`
Branch: `feat/vercel-fullstack`
PR head containing this report: `9bf59d238654bd6853adfc3c1204117c58961c4b`
PR base at task start: `d75339365f2af6e7be913e773ad9f057050afe3c`

The browser result was recorded during the work that produced the PR head above, before the later Dedicated Worker follow-up. The original run record identified the task-start base as “Baseline HEAD”; it did not capture the exact checkout SHA loaded by the browser. Treat the result as historical, task-reported evidence for the non-Worker implementation, not as an independently reproduced result for a precisely fingerprinted browser build.

## Outcome

**PUBLIC_ZSA_E2E_PASS (recorded historical result)** — a real browser-generated HCP1 proof for a genuine eligible testnet note was accepted by the API; stateless verification, replay protection, tamper rejection, privacy inspection, and insufficient-balance rejection were exercised against public QEDIT ZSA data.

No blockchain transaction, push, or deployment was performed during the E2E. The one-note MVP protocol is unchanged.

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

## Submission stabilization: cold path and evidence boundaries

No new full-chain benchmark or Worker redesign was run during this stabilization. The following values are preserved from prior task records and the separate local-only Phase 2 WIP report; the later WIP measurements are not measurements of the stable PR code and were not a controlled side-by-side comparison.

| Measurement | Recorded result | Limit |
| --- | --- | --- |
| Historical cold snapshot baseline | 509,443 ms | Previously recorded result; conditions were not retained well enough for a controlled comparison. |
| Later cold snapshot, cap 8 | 919,090 ms, HTTP 201 | The reported duration is 19,090 ms above the nominal 900,000 ms boundary despite the captured HTTP 201. The record does not preserve a comparable proxy/client timing boundary, so this is not a reliable latency guarantee. |
| Later cold snapshot, cap 9 | 884,656 ms, HTTP 201 | Only about 15.3 seconds below the boundary; not a reliable guarantee. |
| Earlier cold snapshot, cap 10 | 840,604 ms, HTTP 201 | A separate run; not a controlled comparison. |
| Latest cold cap-10 request | Client exceeded 900,000 ms without an HTTP response | Server completion time and final HTTP status were not captured. |
| Historical cold action-range pass | 1,252,120 ms | A separate 475-range sequential pass; its cache condition was not retained. |
| Warm 475 action-range retrieval | 36,477–38,139 ms, 475/475 HTTP 200 | Ran after snapshot derivation had seeded the process cache; this is warm-only and not a cold-path speedup. |

The cap-8 cold snapshot recorded 15,197 RPC attempts, no retries or failures, 408,976,456 response bytes, and peak concurrency 8. Aggregate RPC time was 4,200,670 ms for `getblock` and 2,169,282 ms for `getblockhash`; aggregate RPC queue wait was 4,474,304 ms. The separate latest cap-10 attempt recorded 7,388 `getblockhash` and 7,376 `getblock` attempts, no retries or failures, 199,766,912 response bytes, and peak concurrency 10. Aggregate RPC time was 2,709,074 ms for hashes and 4,683,678 ms for blocks; block decoding took 12,469 ms and queue wait 410.9 ms. An RSS sample was 85,233,664 bytes, not a peak. The RPC totals are cumulative request durations and should not be interpreted as wall time.

A separate 24-block read-only probe fetched raw `getblock` responses at caps 1, 8, and 10 in 17,983 / 3,163 / 2,628 ms, with about 670 KB transferred per sample and no failures. At cap 8, p50/p95 were 465/778 ms; at cap 10, 442/1,058 ms. Verbosity-2 responses for the same sample were about 1.33 MB. Cap 12 and cap 16 full-snapshot attempts failed with `ZCASH_RPC_UNAVAILABLE`; cap 12 followed the cap-16 failure. This small probe shows that the public endpoint can serve a small concurrent sample, but it cannot establish full-snapshot capacity or isolate server scheduling from transfer contention. Current cold-path reliability remains unresolved; the 900,000 ms proxy boundary was not increased during the follow-up.

The public browser E2E's 475-range complete scan took about 1,410,512 ms and used about 5.0 MB of response data. The separate warm follow-up used 11,006,184 response bytes and packed 4,141,932 action bytes. Those runs have different cache and measurement conditions; no cold-versus-warm percentage improvement is claimed.

The local-only Worker follow-up is preserved separately and is not part of the stable PR head or the historical positive E2E. A real-note Worker scan returned `PROOF_GENERATION_FAILED` before generating or submitting a proof. It therefore did not establish positive Worker proof validity, stateless verification, replay, tamper rejection, cancellation, or duplicate-submission acceptance. An inspected attempt showed same-origin Worker/WASM loading and no private key, decrypted note, balance, or witness in observed network requests or logs; storage, cancellation, duplicate interactions, and sustained responsiveness were not fully validated. Do not present the Worker as passing.

## PRD §24 acceptance status for the stable baseline

| Criterion | Status | Evidence boundary |
| --- | --- | --- |
| A. Repository | PASS | The repository uses only the documented `backend/`, `frontend/`, and `docs/` project directories. |
| B. ZSA | RECORDED PASS | The public QEDIT testnet identity and snapshot 7596 were checked during the historical E2E. |
| C. Claim | RECORDED PASS | The historical browser proof was accepted for an immutable claim at snapshot 7596. |
| D. Privacy | RECORDED PASS | The E2E record says the submit body and stored state were inspected; no private witness values were found. Not independently rerun in this stabilization. |
| E. Proof | RECORDED PASS | One real eligible note produced the accepted HCP1 proof; no multi-note support is claimed. |
| F. Verification | RECORDED PASS | Historical stateless valid/tampered checks and Rust adversarial wrong-asset/wrong-snapshot cases are recorded. |
| G. Replay | RECORDED PASS | Identical accepted submission returned HTTP 409 `NULLIFIER_USED`. |
| H. Domain separation | RECORDED PASS | The same note produced a distinct alternate nullifier under a second claim domain. |
| I. Browser | RECORDED PASS | The public one-note flow was exercised in ChatGPT Browser; exact runtime checkout SHA was not captured. |
| J. Build | PASS IN THIS TURN | The Rust, backend, and frontend commands listed in the stabilization validation section below were rerun on the stable source plus minimal local API/docs alignment changes. |
| K. Documentation | PASS AFTER THIS CHANGE | PRD, API, README, HACKATHON, CRYPTO, SETUP, and this report now distinguish observed results from limitations. |
| L. Honesty | PASS AFTER THIS CHANGE | One-note scope, the negative `u64::MAX` test, cold latency, and the absence of a demonstrated public Alice/Bob pair are explicit. |

The historical criteria above are recorded prior-task evidence, not a fresh browser E2E. Cold snapshot reliability remains a submission limitation even though cold latency is not a separate lettered §24 criterion.

## Stabilization changes

- Reconciled PRD §14.2 with the implemented `status=active|expired` filter and documented that filtering precedes cursor/limit pagination.
- Reconciled PRD §14.5–14.6 with HCP1's embedded nine public fields; the API does not accept a separate `publicInputs` object.
- Clarified that current proving supports one normal note and that the Alice/Bob and `u64::MAX` examples do not demonstrate two testnet holders.
- Updated README, HACKATHON, CRYPTO, API, SETUP, TESTING, and this report with historical evidence boundaries, build instructions, and cold/warm measurements; reviewed SECURITY, which was already consistent.

## Implementation changes

- Corrected Halo2 adversarial public-input vectors to include all nine circuit inputs and isolate each intended invalid property.
- Added Rust insufficient-balance regression coverage.
- Mapped unknown API exceptions to `INTERNAL_ERROR` / HTTP 500 and malformed JSON to `BAD_REQUEST` / HTTP 400; aligned verifier/prover unavailable terminology in docs.
- Pinned the ZSA testnet genesis identity and retained canonical block/root checks for public actions.
- Added bounded retries for transient public action-range failures while preserving in-order and canonical-chain validation.
- Set the frontend rewrite proxy timeout from the measured 30-second failure to 15 minutes.

## Historical public E2E task validation

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

An earlier backend `bun run check` invocation failed during command resolution; after clearing the shell command cache, `bunx` resolved to the Linux Bun wrapper and a fresh `bun run check` passed. The exact cause of the earlier discrepancy was not established. No build or test substitutes for the public browser E2E evidence above.

## Submission stabilization validation (2026-10-27)

Commands ran in WSL2 Ubuntu 24.04 from `/home/acer/projects/horoi` with Linux Git, Bun 1.4.3, Cargo 1.99.1, and Rust 1.99.1. Both frozen Bun installs completed with no lockfile changes.

- `cd backend && bun install --frozen-lockfile` — passed, no changes.
- `cd frontend && bun install --frozen-lockfile` — passed, no changes.
- `cd backend/rust && cargo +1.99.1 fmt --check` — passed.
- `cd backend/rust && cargo +1.99.1 check --locked --all-targets` — passed.
- `cd backend/rust && cargo +1.99.1 test --locked --features test-utils --all-targets` — 18 passed, 0 failed; library and verifier unit-test targets contained 0 tests.
- `cd backend && bun test server.test.ts` — 3 passed, 14 assertions, including status filtering before cursor/limit and unchanged unfiltered pagination.
- `cd backend && bun run check` — passed.
- `cd backend && bun run build` — passed.
- `cd frontend && bun run check` — passed.
- `cd frontend && bun run build` — passed.
- `git diff --check` — passed after the documentation and API changes.

No browser E2E, testnet transaction, or full-chain performance benchmark was run during this stabilization. The Rust/WASM release artifact was not regenerated because no Rust/WASM source changed and Clang 18 was not available in this WSL shell; the installed wasm target and `wasm-bindgen-cli` were present. The positive public-testnet result above remains the prior task's historical evidence.

## Cleanup from the original stabilization run

The prior E2E task stopped its backend/frontend processes and removed its temporary scan resources. During the original stabilization run, no server, browser session, transaction, or persistent process was started; build and test commands exited normally. Ports 3000, 8787, and 8788 were checked closed after that validation.

## Docker Judge Demo acceptance (2026-10-27)

**DOCKER_JUDGE_DEMO_VERIFIED locally.** These results are separate from the historical public QEDIT testnet E2E above. The judge fixture is a local synthetic Orchard test fixture, not a public-chain snapshot or public QEDIT proof.

| Check | Result | Evidence |
| --- | --- | --- |
| Compose config and production images | PASS | `docker compose config --quiet` and `docker compose build` passed from `/home/acer/projects/horoi`; Rust 1.99.1 compiled the release `horoi-verifier`, and both images used frozen Bun/Cargo dependencies. |
| Startup ordering and health | PASS | `docker compose up -d` started backend first; backend became healthy before frontend started. Both containers reported healthy. |
| Browser route and existing routes | PASS | ChatGPT Browser rendered `/demo`; `/`, `/claims`, `/create`, `/verify`, `/demo`, and the pinned claim details route each returned HTTP 200. |
| Genuine HCP1 positive | PASS | Browser scenario A returned HTTP 200, `valid: true`, verifier `horoi-verifier`. Backend startup and the API use the native Rust verifier. |
| Tampered HCP1 proof | PASS | Browser scenario B returned HTTP 200, `valid: false`, `INVALID_PROOF` from the native verifier after one proof byte was flipped. |
| Claim-domain replay | PASS | Browser scenario C returned first submission HTTP 201 and the identical proof/nullifier replay HTTP 409 `NULLIFIER_USED`. After backend restart the duplicate remained 409. After `docker compose down -v --remove-orphans` and a fresh start, the same deterministic sequence returned 201 then 409. |
| Host exposure and persistence | PASS | Only frontend `127.0.0.1:3000` was host-published; backend had no host binding. SQLite replay state survived backend restart. The scoped reset removed only `horoi-judge` containers, volume, and networks. |
| Runtime permissions and limits | PASS | Both images run as `bun`; root filesystems are read-only with dropped capabilities and `no-new-privileges`. SQLite data directory is `0750`, database is `0640`. Backend is capped at 512 MiB/1 CPU and frontend at 256 MiB/0.5 CPU. |
| Startup RPC and sensitive logging | PASS | Judge Compose has no RPC credentials, uses an internal backend network, and rejects claim creation/action-range routes with `DEMO_READ_ONLY`. Backend logs contained only request route/status/timing metadata; the sensitive-term scan found no witness, spending-key, seed, mnemonic, or full-view-key data. |
| Fixture provenance | PASS | `backend/fixtures/judge-hcp1.json`, SHA-256 `2fb21151e3dc2413b041b2509a10f6e6b408b1e599b32aa5e5671ba0b2e21554`; network `zebra-regtest`, snapshot height 3. It was generated by the existing Rust scanner test utility from local Orchard test notes; no Zebra node or public QEDIT scan produced the roots. |

The default Compose file uses an internal backend network plus a frontend-only edge bridge so Docker Desktop can publish the loopback frontend port while the backend remains unpublished. The public profile uses a separate Compose project name and loopback port `3001`. The initial VPS preflight found ports 80/443 owned by the existing `unmet-web` Caddy 2.11.2 container, no standalone host Caddy service/configuration, and 1.9 GiB total memory. Reusing the proxy would require changing the UNMET web container, so no unrelated service or shared proxy configuration was changed.

On 2026-10-27, a read-only VPS check confirmed the isolated `horoi-public` project was running: backend and frontend were healthy, `http://127.0.0.1:3001/demo` returned HTTP 200, only the frontend was host-bound, and the backend exposed no host port. The deployed image IDs were backend `sha256:aa16e2828b31fa473ee0e3f746a92c23b95b5d27cb0fd8df51b20b700d2a6053` and frontend `sha256:80fb784ff59d0648c034fd7a2ad64975a975a4447912de4231758ea6df76f04a`. The deployment directory is `/opt/horoi-public-3dfb58c`, corresponding to source commit `3dfb58c983536a087327c82b4f68870e197f09b4`; the host checkout has no Git metadata, so that source identity is recorded from the isolated deployment directory and its matching validated image IDs. Later on 2026-10-27, both Horoi containers were stopped at user direction with the SQLite volume preserved; a follow-up check found no listener on `127.0.0.1:3001`. The service had been loopback-only. No public HTTPS URL or external unauthenticated browser acceptance exists; `PUBLIC_HTTPS_STATUS=NOT_CONFIGURED_BY_USER_DIRECTION`.

The backend Rust release binary was built locally before running Bun tests. The default 5-second Bun test timeout can expire while the server validates the pinned fixture through the native verifier during test setup. The supported reproducible sequence is recorded in `docs/TESTING.md`: build the locked release verifier, then run `bun test --timeout=30000 --parallel=1`. That command passed both test files (5 tests, 31 assertions). The teardown tolerates setup failure without masking the original error.
