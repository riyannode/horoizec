# Public QEDIT ZSA Testnet Validation

Date: 2026-10-25
Repository: `riyannode/horoizec`
Branch: `feat/vercel-fullstack`
Original PR head for the historical public E2E record: `9bf59d238654bd6853adfc3c1204117c58961c4b`
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

The initial claim-creation frontend request exposed a 30-second Next.js rewrite proxy timeout: the backend took 563,147 ms and persisted the claim, while the frontend proxy reset the response. The installed Next.js 16.4 runtime confirmed its rewrite proxy timeout default is 30,000 ms. `frontend/next.config.ts` now sets `experimental.proxyTimeout` to 900,000 ms, exceeding the measured request and removing that measured boundary for the historical run. A separate 2026-10-27 request still closed after 30 seconds; its timer owner remains unproven below.

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

## Historical PRD §24 acceptance snapshot for the stable baseline

| Criterion | Status | Evidence boundary |
| --- | --- | --- |
| A. Repository | `PASS_HISTORICAL_ONLY` | The earlier stable baseline used the documented `backend/`, `frontend/`, and `docs/` project directories. |
| B. ZSA | `PASS_HISTORICAL_ONLY` | The public QEDIT testnet identity and snapshot 7596 were checked during the historical E2E. |
| C. Claim | `PASS_HISTORICAL_ONLY` | The historical browser proof was accepted for an immutable claim at snapshot 7596. |
| D. Privacy | `PASS_HISTORICAL_ONLY` | The E2E record says the submit body and stored state were inspected; no private witness values were found. |
| E. Proof | `PASS_HISTORICAL_ONLY` | One real eligible note produced the accepted HCP1 proof; no multi-note support is claimed. |
| F. Verification | `PASS_HISTORICAL_ONLY` | Historical stateless valid/tampered checks and Rust adversarial wrong-asset/wrong-snapshot cases are recorded. |
| G. Replay | `PASS_HISTORICAL_ONLY` | Identical accepted submission returned HTTP 409 `NULLIFIER_USED`. |
| H. Domain separation | `PASS_HISTORICAL_ONLY` | The same note produced a distinct alternate nullifier under a second claim domain. |
| I. Browser | `PASS_HISTORICAL_ONLY` | The public one-note flow was exercised in ChatGPT Browser; exact runtime checkout SHA was not captured. |
| J. Build | `PASS_HISTORICAL_ONLY` | The stable-baseline Rust, backend, and frontend commands are retained in the earlier validation record. Current checks are listed in the current matrix below. |
| K. Documentation | `PASS_HISTORICAL_ONLY` | The earlier record reconciled the PRD, API, README, HACKATHON, CRYPTO, SETUP, and report docs. |
| L. Honesty | `PASS_HISTORICAL_ONLY` | The earlier record disclosed one-note scope, the negative `u64::MAX` test, cold latency, and no demonstrated public Alice/Bob pair. |

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

## Initial Docker Judge Demo acceptance (2026-10-27; replay behavior superseded below)

These initial results are separate from the historical public QEDIT testnet E2E above. The judge fixture is a local synthetic Orchard test fixture, not a public-chain snapshot or public QEDIT proof. The original persistent replay sequence is retained as historical acceptance evidence; its behavior was replaced by the repeatable isolated walkthrough documented in the final acceptance section below.

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

On 2026-10-27, a read-only VPS check confirmed the isolated `horoi-public` project was running: backend and frontend were healthy, `http://127.0.0.1:3001/demo` returned HTTP 200, only the frontend was host-bound, and the backend exposed no host port. The deployed image IDs were backend `sha256:aa16e2828b31fa473ee0e3f746a92c23b95b5d27cb0fd8df51b20b700d2a6053` and frontend `sha256:80fb784ff59d0648c034fd7a2ad64975a975a4447912de4231758ea6df76f04a`. The deployment directory is `/opt/horoi-public-3dfb58c`, corresponding to source commit `3dfb58c983536a087327c82b4f68870e197f09b4`; the host checkout has no Git metadata, so that source identity is recorded from the isolated deployment directory and its matching validated image IDs. Later on 2026-10-27, both Horoi containers were stopped with the SQLite volume preserved; a follow-up check found no listener on `127.0.0.1:3001`. No public HTTPS URL or external unauthenticated browser acceptance existed at that checkpoint. The current Caddy reload limitation is documented below.

The backend Rust release binary was built locally before running Bun tests. The default 5-second Bun test timeout can expire while the server validates the pinned fixture through the native verifier during test setup. The supported reproducible sequence is recorded in `docs/TESTING.md`: build the locked release verifier, then run `bun test --timeout=30000 --parallel=1`. That command passed both test files (5 tests, 31 assertions). The teardown tolerates setup failure without masking the original error.

## Final repeatable Docker acceptance (2026-10-27)

This is the latest local Docker Judge Demo behavior. It uses the same pinned public fixture and canonical native Rust verifier described above; it is not public QEDIT testnet evidence.

| Check | Result | Evidence |
| --- | --- | --- |
| Clean production image build | PASS | `docker compose config --quiet`, public override config, and `docker compose --project-name horoi-final-label-build build --no-cache backend frontend` passed on Linux/x86_64. The build used frozen Bun dependencies, Rust 1.99.1 with `cargo build --locked`, and digest-pinned Bun/Rust bases. No `.env` or host-built verifier was present. |
| Startup and route rendering | PASS | `docker compose up -d` started backend first, waited for healthy native-fixture verification, then started the frontend. Both became healthy. `/`, `/claims`, `/create`, `/verify`, `/demo`, and the pinned claim detail returned HTTP 200. The browser rendered `/demo` and showed the immutable claim, LOCAL SYNTHETIC TEST FIXTURE provenance, and privacy boundary. |
| Valid and tampered HCP1 | PASS | Browser Scenario A returned `HTTP 200 · valid: true · horoi-verifier`. Scenario B flipped one proof byte and returned `HTTP 200 · valid: false · horoi-verifier returned INVALID_PROOF`. Both used the same Rust verifier. |
| Repeatable claim-domain replay | PASS | Browser Scenario C returned a genuine first proof acceptance and a second verifier-plus-SQLite rejection with `NULLIFIER_USED`. Two separate walkthrough requests each returned HTTP 200 with those actual operation results. Each request created and closed an in-memory SQLite database using the production migration and unique nullifier constraint. The persistent database's `nullifiers` count remained zero, including after backend restart. |
| Global and visitor limits | PASS | Three simultaneous native-verifier operations through the default stack returned two HTTP 200 and one HTTP 429 with `Retry-After: 2`. In the public Compose override, nine invalid requests carrying only `X-Forwarded-For` all reached validation (HTTP 400); eight with the configured `X-Horoi-Client-IP` reached validation and the ninth returned HTTP 429 with `Retry-After: 60`. The identity is accepted only when the public override enables proxy trust. |
| Network, privacy, and resource isolation | PASS | Backend had no host port; frontend alone bound to `127.0.0.1:3000` (judge) or `127.0.0.1:3001` (public profile). Backend used the internal Docker network. Both ran as `bun` with read-only root filesystems; backend was limited to 512 MiB/1 CPU and frontend to 256 MiB/0.5 CPU. The frontend image contained no backend fixture. Private-term scans of both backend logs and credential-name scans of backend environment returned zero matches. Claim creation and action-range endpoints returned `DEMO_READ_ONLY`, so startup did not initiate a public RPC scan. |
| Final test resource cleanup | PASS | The temporary `horoi-final-label-build` and `horoi-final-public-label-build` projects were stopped and removed with project-scoped `down -v --remove-orphans`. Their volumes and networks were absent afterward; pre-existing Horoi judge data was not touched. Windows ports 3000, 3001, and 8787 had no listener after cleanup. |

The test images were tagged `horoi/horoi-backend:unknown` and `horoi/horoi-frontend:unknown`, with matching `org.opencontainers.image.revision=unknown` labels because this acceptance ran before the release commit existed. Release builds set `HOROI_SOURCE_SHA` to the exact Git commit; the final SHA and deployed image identities belong in the PR update and final task report.

## Current PRD §24 acceptance summary

| Criterion | Status | Evidence boundary |
| --- | --- | --- |
| A. Repository shape | `PASS_CURRENTLY_VERIFIED` | Tracked source is organized under `backend/`, `frontend/`, and `docs/`; root Compose files define the separate Judge and public profiles. The preserved Phase 2 Worker commit remains on its WIP branch. |
| B. Compatible pinned ZSA environment | `PARTIAL` | The live RPC reports `chain=test`, QEDIT genesis `f41f61dd…9505756`, active NU7, Zebra 5.2.0/protocol 170160, and a canonical snapshot-7596 hash/root. Current RPC does not reveal the running Zebra Git revision. QEDIT tooling source pins are linked in the fresh-attempt record below. |
| C. Immutable claim | `PASS_CURRENTLY_VERIFIED` | Live claim `401cdcfbe89267bd9daa18e668349986388a5a1a44b77a7c3c8bb6cb6778d44d` binds the ZIP 227 AssetId, threshold 100, and canonical block-1 roots. The fresh snapshot-8457 job failed before inserting another claim. |
| D. Browser-local privacy | `PASS_HISTORICAL_ONLY` | The 2026-10-25 public-testnet proof submit body was inspected and contained no spending key, note, balance, or witness. The 2026-10-27 attempt entered no key and submitted no proof. |
| E. Real ownership proof | `PASS_HISTORICAL_ONLY` | The historical one-note public-testnet HCP1 proof was accepted and independently verified. No new proof was generated on the current deployed release; `/demo` remains a synthetic fixture. |
| F. Verification and tamper rejection | `PASS_CURRENTLY_VERIFIED` | The current hosted `/demo` and clean-archive Docker Judge accepted the valid fixture and rejected its tampered proof; the Rust verifier test also rejects wrong AssetId and snapshot inputs. This does not establish a new real-note proof. |
| G. Note-level replay protection | `PASS_CURRENTLY_VERIFIED` | The current hosted demo and clean-archive Docker Judge each accepted the first synthetic submission and rejected its duplicate with `NULLIFIER_USED` using isolated SQLite and the production unique constraint. The real-note public replay result remains historical. |
| H. Claim-domain separation | `PASS_CURRENTLY_VERIFIED` | Current `cargo +1.99.1 test --locked` passed all 18 Rust tests, including claim-domain and alternate-nullifier separation cases. |
| I. Complete browser E2E | `PASS_HISTORICAL_ONLY` | The complete real-note browser flow is recorded for 2026-10-25 only. The fresh snapshot-8457 job returned HTTP 202, ran for about 11m24s, then failed with `SNAPSHOT_UNAVAILABLE` before a claim was inserted. No current proof, stateless verification, replay, or tamper steps ran. |
| J. Required checks and builds | `PASS_CURRENTLY_VERIFIED` | The current working-tree backend change passed typecheck, build, and 20 focused tests (149 assertions); the native Rust verifier and frontend production image rebuilt successfully. Rust fmt/check/18 tests/release build and frontend check/build had passed at the `ce36f60` checkpoint and those sources were unchanged. The isolated Docker Judge build became healthy and browser valid/tamper/replay scenarios passed; hosted `/demo` passed the same three scenarios in the ChatGPT in-app browser. |
| K. Documentation consistency | `PASS_CURRENTLY_VERIFIED` | This report, `HACKATHON.md`, `THREE_SURFACES.md`, and deployment docs distinguish live, historical, and synthetic evidence. |
| L. Testnet and product disclosures | `PASS_CURRENTLY_VERIFIED` | The docs and UI disclose testnet-only, experimental/unaudited, one-note, note-level replay, no mainnet, and synthetic-fixture limitations. |

## Separate public Docker deployment acceptance (2026-10-27)

This is current deployment evidence for the Docker Judge Demo fixture. It is not a new public QEDIT testnet E2E and does not alter the historical record above.

| Check | Result | Evidence |
| --- | --- | --- |
| DNS and HTTPS | PASS | `horoi.kima.my.id` resolves to `43.156.68.254`. From an external Windows client, `/` and `/demo` returned HTTP 200 with TLS verification result 0; an unauthenticated browser loaded the public demo. |
| Caddy persistence and route | PASS | `unmet-web-1` now mounts the active Caddyfile read-only from `/opt/horoi-caddy-d6cc100/Caddyfile` (SHA-256 `f454b12506d1d5cfe2bd84772d067333e83f061d47fa526d1e7e7784af3e1c9d`) and reaches `frontend-public:3000` over `horoi-public_edge`. Existing UNMET Caddy site blocks were preserved. |
| UNMET protection | PASS | Only `unmet-web-1` was recreated. The UNMET API container ID, image, environment, health, and payment/Caddy volume names and mountpoints stayed unchanged. After cutover, `/`, `/health`, `/ready`, `/live`, and `/v1/demands` returned HTTP 200. |
| Public API and routes | PASS | `/api/v1/health`, `/api/v1/demo/fixture`, `/api/v1/claims`, and fixture claim details returned HTTP 200 over trusted HTTPS. Backend `8787/tcp` has no host binding; frontend is bound only to `127.0.0.1:3001`. |
| Genuine and tampered HCP1 | PASS | Public browser Scenario A displayed `HTTP 200 · valid: true · horoi-verifier`. Scenario B displayed `HTTP 200 · valid: false · horoi-verifier returned INVALID_PROOF`. |
| Repeatable replay | PASS | Public browser Scenario C accepted the first genuine proof, rejected its repeated note-level alternate nullifier with `NULLIFIER_USED`, and produced the same result again on a separate run using isolated per-run SQLite state. |
| Release identity | PASS | Public backend/frontend labels identify source `d6cc100968aa9975930d71213439d2b3c9c5dd01`. Backend image digest is `sha256:d7b76c5b7d1c18760b7df4e1a3623532cb3f7069e3365165505267e56b6dde5e`; frontend digest is `sha256:7c0f5ad19d334402bd2e76dfa2173b5026bf54a4ae5c8356a869ac27dd6fde25`. |

The public working demo requirement is now met by the verified Docker URL [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo). The historical public QEDIT testnet proof remains distinct from the deployed synthetic fixture walkthrough.

## Fresh public QEDIT attempt (2026-10-27)

This attempt supplements the historical 2026-10-25 proof record; it does not replace or extend it.

### Network and toolchain checks

Read-only checks from the live backend container against `https://rpc.test-zsa.org` reported `chain=test`, tip height 8433 (`a088b41463c8382f662d3176ab8f2c7b0d9f73e88e4d0e6b332662b4676a4192`), expected genesis `f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756`, active NU7, `/Zebra:5.2.0/`, protocol 170160, and no warnings. Snapshot 7596 still resolves to hash `117825b695547d089c056686db855cdb63fadc279a9c2ab39b713eb6f656a457` and Orchard root `6eec05f584ea828d325ffd69d4d34b91e85f4db9fe16d6d727a381ecb009f610`.

At the checked snapshot and tip-adjacent blocks, `getblock` returned version-6 transactions with Orchard actions. The live backend's bounded action-range API returned HTTP 200 for blocks 1–16 (16 blocks, 40 Orchard actions), block 7596 (2 Orchard actions), and the then-current tip block 8430 (2 Orchard actions). These targeted reads verify those data paths only; they do not demonstrate that the full snapshot scan completes or that those blocks contain ZIP 227 issuance notes.

The checked-out [QEDIT transaction-tool source](https://github.com/QED-it/zcash_tx_tool) was commit `45413e8a9159bfeb6a9ca829c72f315a49266bc6`; its CI compatibility pin references [QED-it/Zebra `8c9c93f`](https://github.com/QED-it/zebra/commit/8c9c93fdd91b89fab387ec68362a93b2baca7bab). The public RPC identifies Zebra 5.2.0 but does not expose the deployed Git commit, so the exact running revision remains unverified. ZIP 226/227 remain draft specifications: [ZIP 226](https://zips.z.cash/zip-0226), [ZIP 227](https://zips.z.cash/zip-0227).

### Issuance and transfer paths inspected

The current [QEDIT `zcash_tx_tool`](https://github.com/QED-it/zcash_tx_tool) source exposes `test-issue-one`; its public workflow defaults to `rpc.test-zsa.org`. QEDIT's [October 6, 2026 tooling update](https://forum.zcashcommunity.com/t/feature-branch-testnet-and-compatible-developer-tooling/55156/4) identifies tx-tool v0.6.0 as compatible with Zebra 5.2.0. Its older wiki endpoint `dev.zebra.zsa-test.net` is stale for this network and was not used.

The live [Cachet mint page](https://cachetzec.com/mint) identifies its target as the QEDIT-operated public ZSA testnet and offers browser issuance. It keeps the seed and proof local and relays only signed transaction bytes. The checked-out [Cachet source](https://github.com/cachet-zec/cachet) builds a zero-fee issuance for the public testnet and derives its Orchard account key using the same ZIP-32 seed path documented as matching tx-tool. Horoi accepts a raw 32-byte Orchard spending key, so the format is source-level compatible. The later disposable wallet and mint attempt are recorded below. No faucet was assumed or used.

At the time of this earlier failed claim attempt, no asset had been issued. A later follow-up issued one minimal test asset, recorded below. The published tx-tool sample seed and keys derived from it were not used on the public network.

### New claim creation attempt

From the real public `/create` page, a new request targeted the recorded ZIP 227 AssetId, threshold 100, and snapshot height 7596. The UI showed “Resolving snapshot…” and then reported that the response body began with plain-text `Internal Server Error`. The instrumented live backend recorded request ID `a440192c-32ff-406f-8b73-f56e70b679e1`, route `POST /api/v1/claims`, HTTP 503 after 30,002 ms, stage `snapshot_resolution`, snapshot height 7596, error code `SNAPSHOT_UNAVAILABLE`, failure category `request_closed`, and `aborted=true`. The snapshot scan log recorded an in-flight `getblockhash` attempt at block 384, aborted by its parent after 738 ms. The scan failed after 29,992 ms with `parent_abort`; RPC did not return an upstream HTTP error or invalid response. The browser displayed the Next.js plain-text 500 as a JSON parse error. The public claims list stayed unchanged with only the earlier block-1 integration claim. No new claim ID or roots were returned; no key was entered, and no HCP1 proof, replay request, or tamper request was made.

The prior uninstrumented request ID was `f4a97252-69b1-4a5d-96fe-9c68e4f8d9ba`; it also returned backend HTTP 503 at 30,002 ms but lacked a stage trace. The new request establishes that this failure was not the three 10-second RPC attempts exhausting their own timeout: the live scan was canceled by the parent request while one `getblockhash` call was in flight. `backend/server.ts` sets a 14-minute route deadline and `backend/zcash.ts` sets a 12-minute snapshot deadline. The running Next.js 16.4.0 image has `experimental.proxyTimeout=900000`; its proxy logs `ECONNRESET` and emits the plain-text body. The Caddyfile in the healthy `unmet-web` container matches SHA-256 `f454b12506d1d5cfe2bd84772d067333e83f061d47fa526d1e7e7784af3e1c9d`; the Horoi site block has no short proxy timeout. The trace records a request close and parent abort but emits no upstream HTTP status, so it does not show an RPC HTTP error or invalid RPC response. These observations locate the failure at an upstream connection close, but do not identify which client/network timer closes it at 30 seconds. No timeout was increased and no scan was repeated after this trace.

An isolated Bun 1.4.3 idle-timeout probe inside the backend image closed a synthetic 40-second handler at about 12 seconds, so Bun's default idle timeout does not explain this observed 30-second boundary. It did not touch the live backend process or databases.

### Disposable wallet, public mint, and async snapshot follow-up (2026-10-27)

The deployed source at the start of this attempt was `ce36f60ce5f6dc761bf7b78b849952d172a2a343`. A new disposable BIP39 wallet was derived inside WSL from the existing task-local seed. The account-0 Orchard spending key parsed with Horoi's pinned `SpendingKey::from_bytes`; the FullViewingKey and receiving address matched Cachet's account-0 derivation for the same seed. Secret files remained untracked with mode `0600` and are excluded from this report.

Cachet and QEDIT were confirmed on the same public QEDIT ZSA testnet. The RPC reported `chain=test`, genesis `f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756`, active NU7, and tip 8457. Cachet minted one minimal test asset; transaction `38532f264341786558ac364609440917d6d1541bc4ebbf37c51efb7203a3df42` is included in block 8457, hash `61d797ffadeddc088e736935fcb4cb3ce9d81af565d2c0fb56ac0a3b865937f3`. The canonical ZIP 227 AssetId is `00004943c752e22917f2ca78a020e56177ecbbf030701439892b649c1da0f40cf251a1a2c3efb06d000f62c57ac10fa18a50a0ba4a494545101394716ebb984bb17e`; its derived AssetBase matched Cachet's public asset page. No transfer or second mint was made. The issuance transaction is confirmed, but a Horoi-eligible note has not yet been confirmed by the browser scanner or circuit.

The real public `/create` form submitted this AssetId with threshold `1` and snapshot height `8457`. `POST /api/v1/claims/jobs` returned HTTP 202 and job `26afcb2e-9738-4523-8b70-3728cc175a25`; status polls returned HTTP 200. The job later failed with `SNAPSHOT_UNAVAILABLE`, public stage `snapshot_resolution`, and no claim ID or persisted claim. A subsequent public claims-list read returned the two existing claims at heights 512 and 1, with no 8457 claim. Browser timing places the POST at `2026-10-27T15:38:29.087Z` and the first observed terminal failure at `2026-10-27T15:49:53.127Z` (684,040 ms elapsed). The endpoint does not expose the internal RPC method or block. The available WSL SSH key was rejected by the VPS, so the backend's structured log for this job could not be retrieved; do not infer a specific failing RPC call or failure category.

After the job failed, bounded direct RPC probes for `getblockhash` at heights 1, 384, and 8457, `z_gettreestate` at 8457, and `getblock` at 384 and 8457 returned HTTP 200 in 53–860 ms. The current height-8457 Orchard root was `2c5ac7719654b79bf136f95dd7d0148a02424671622ab227d2bfb7ee221aeb36`. These point probes confirm individual method availability only; they do not identify the failed scan request or prove full-scan reliability. No real claim, browser proof, verifier acceptance, stateless verification, replay, or tamper result exists for this mint.

The working tree now contains a bounded process-memory checkpoint/resume change. It reuses only completed 16-block ranges after checking their current canonical end hashes, reports the last completed range in job status, and preserves the existing final snapshot-root and reorg checks. It has not yet been deployed or exercised against QEDIT. Checkpoints and job status are lost on backend restart; local tests cover resume and reorg invalidation.

### Updated local Judge and hosted demo checks (2026-10-27)

After the prior `ce36f60` source checkpoint had been deployed, the ChatGPT in-app browser submitted one claim job for snapshot 8457. The public claims list still contained only the two existing claims at heights 512 and 1; no snapshot-8457 claim was inserted. The job details and limitations are recorded above.

The working tree was built with `docker compose --project-name horoi-resume-test up --build -d`. Both isolated containers became healthy; local `/api/v1/health` and `/demo` returned HTTP 200, with `network: zebra-regtest`. The ChatGPT in-app browser opened the Judge at `http://localhost:3000/demo`: the valid fixture returned `HTTP 200 · valid: true · horoi-verifier`, the tampered fixture returned `HTTP 200 · valid: false · horoi-verifier returned INVALID_PROOF`, and replay accepted its first synthetic proof and rejected the repeated nullifier with `NULLIFIER_USED`. The hosted `https://horoi.kima.my.id/demo` returned the same three scenario results in the ChatGPT in-app browser. This validates the synthetic Judge and hosted demo only; it is not public QEDIT ownership evidence. The isolated Compose resources were removed after the run.

### Current Docker Judge verification

The committed source archive at `80f9f3da2c278a0bcb4f48bf910a8136fd10e30f` built the zero-credential Docker Judge images. Both containers became healthy. On local `localhost:3000/demo`, the valid fixture returned HTTP 200/`valid: true`; tampering returned HTTP 200/`valid: false` with `INVALID_PROOF`; the replay walkthrough accepted the first fixture submission and rejected the duplicate with `NULLIFIER_USED` in isolated SQLite. The same three scenarios were observed on public `/demo`.

After the diagnostic source was pushed, a fresh unauthenticated clone of public default branch `feat/vercel-fullstack` at `92710678a2efad1b27552e9345c41036a604ed3f` ran the required `docker compose up --build`. Both containers became healthy; `/api/v1/health` returned HTTP 200 with `network: zebra-regtest`. In the ChatGPT in-app browser at `http://127.0.0.1:3000/demo`, the valid fixture returned HTTP 200/`valid: true`, tampering returned HTTP 200/`valid: false` with `INVALID_PROOF`, and replay accepted the first proof then rejected the duplicate with `NULLIFIER_USED`. The Judge Compose project, test volume, and networks were removed after the run; ports 3000 and 8787 had no listener afterward. This remains synthetic Judge evidence only.

The first isolated Compose project, volume, networks, and local image tags were removed after validation. This verifies the Docker Judge surface only. The diagnostic source `92710678a2efad1b27552e9345c41036a604ed3f` was then pushed to PR branch `feat/vercel-fullstack` and deployed through the existing public Compose project. The live and demo backends use image ID `sha256:f6bd059c7632c796c1f7d0c44f9bb6597241c9303769cb4859899c479d434c18`; the frontend uses image ID `sha256:82df14adc68f4019f897784b7b0320712889d0ce76d0a7b4a982300b38d177a2`. Both SQLite integrity checks returned `ok`; live remains at one claim/zero nullifiers and demo at one claim/one nullifier. This deployment contains safe diagnostics only; no behavioral timeout fix has been applied. The PR description and submission pack are being updated to this evidence; no merge or official submission occurred.
