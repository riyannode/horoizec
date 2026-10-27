# Testing and validation

All Horoi commands run in WSL/Linux. Rust owns cryptographic invariants. Backend API tests cover status-filter pagination, malformed JSON, and the Docker fixture valid/tampered/replay paths. Frontend behavior uses typecheck, production builds, and manual browser validation; the repository does not carry a Playwright/Cypress/Vitest frontend suite.

## Commands

From the repository root:

```sh
(cd backend/rust && cargo +1.99.1 build --locked --release --bin horoi-verifier)
(cd backend && bun install --frozen-lockfile && bun run check && bun test --timeout=30000 --parallel=1 && bun run build)
(cd frontend && bun install --frozen-lockfile && bun run check && bun run build)
(cd backend/rust && cargo +1.99.1 fmt --check)
(cd backend/rust && cargo +1.99.1 check --locked --all-targets)
(cd backend/rust && cargo +1.99.1 test --locked --features test-utils --all-targets)
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
curl --fail http://localhost:3000/demo
docker compose down -v --remove-orphans
```

For the HTTP/browser acceptance, open `/demo` in a browser, verify that the valid fixture returns `valid: true`, the tampered fixture returns `INVALID_PROOF`, and the replay walkthrough reports a genuine first SQLite acceptance followed by `NULLIFIER_USED` from a second native HCP1 verification. Run the replay button more than once; each request owns and closes its temporary SQLite database, and the persistent `nullifiers` table remains unchanged. Check backend health before frontend, only frontend publishes a port, concurrent verifier admission is bounded, rate-limited responses include `Retry-After`, and no public RPC request or snapshot scan occurs. `docker compose down -v --remove-orphans` resets only `horoi-judge` resources. The actual Docker results for this checkout are recorded in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).

For live claim creation, the browser starts `POST /api/v1/claims/jobs` and receives HTTP 202 before snapshot scanning begins. Confirm status polling reaches `completed`, then open the returned claim and verify its stored height and roots. A user cancellation should return `cancelled`; a transient polling error must not be treated as evidence that the backend job stopped. This transport check does not establish eligible-note ownership or proof acceptance.

The backend snapshot-resume regression is covered by `bun test --timeout=30000 --parallel=1 zcash-snapshot.test.ts zcash-checkpoints.test.ts`. It aborts after a complete range, resumes only after checking the range-end hash, invalidates later ranges after a simulated reorg, and verifies that successful completion clears the checkpoint. Checkpoints are process-local and do not survive restart.

The browser WASM build also needs wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129, and Clang 18; see [SETUP.md](SETUP.md).

The backend test timeout is 30 seconds because demo fixture initialization invokes the native Rust verifier before the test assertions run. Keep `--parallel=1`: the suite shares its in-memory server module state and advances the mocked wall clock after exercising the global rate window.

## Browser acceptance evidence

On 2026-10-25, ChatGPT Browser exercised Horoi against public QEDIT ZSA testnet snapshot 7596: a real HCP1 proof was accepted, stateless verification returned `valid: true`, identical replay returned HTTP 409 `NULLIFIER_USED`, and a bit-tampered proof verified as `valid: false`. Browser Network inspection confirmed the submit body contained only claim ID, protocol version, proof, and alternate nullifier; no private key, note, balance, or witness was sent. A real-note insufficient-balance claim returned `NoEligibleNote` in browser WASM. Detailed measurements and limitations are in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).
