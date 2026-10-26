# Testing and validation

All Horoi commands run in WSL/Linux. Rust owns cryptographic invariants. Backend API tests cover status-filter pagination, malformed JSON, and the Docker fixture valid/tampered/replay paths. Frontend behavior uses typecheck, production builds, and manual browser validation; the repository does not carry a Playwright/Cypress/Vitest frontend suite.

## Commands

From the repository root:

```sh
(cd backend/rust && cargo +1.99.1 build --locked --release --bin horoi-verifier)
(cd backend && bun install --frozen-lockfile && bun run check && bun test --parallel=1 && bun run build)
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

For the HTTP/browser acceptance, open `/demo` in a browser, verify that the valid fixture returns `valid: true`, the tampered fixture returns `INVALID_PROOF`, and the replay sequence returns HTTP 201 followed by HTTP 409 `NULLIFIER_USED`. Check that backend is healthy before frontend, only frontend publishes a port, and no public RPC request or snapshot scan occurs. Repeat after `down -v`; this reset removes only `horoi-judge` resources. The actual Docker results for this checkout are recorded in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).

The browser WASM build also needs wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129, and Clang 18; see [SETUP.md](SETUP.md).

## Browser acceptance evidence

On 2026-10-25, ChatGPT Browser exercised Horoi against public QEDIT ZSA testnet snapshot 7596: a real HCP1 proof was accepted, stateless verification returned `valid: true`, identical replay returned HTTP 409 `NULLIFIER_USED`, and a bit-tampered proof verified as `valid: false`. Browser Network inspection confirmed the submit body contained only claim ID, protocol version, proof, and alternate nullifier; no private key, note, balance, or witness was sent. A real-note insufficient-balance claim returned `NoEligibleNote` in browser WASM. Detailed measurements and limitations are in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).
