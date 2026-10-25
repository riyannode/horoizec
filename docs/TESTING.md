# Testing and validation

All Horoi commands run in WSL/Linux. Cryptographic invariants stay in the single Rust integration test file. PRD §20 keeps Bun API/UI suites out of the default testing policy; `backend/server.test.ts` is a narrow exception for the malformed-JSON regression explicitly required by this hardening task. Frontend behavior uses typecheck, production builds, and manual ChatGPT Browser E2E; the repository does not carry a Playwright/Cypress/Vitest frontend suite.

## Commands

From the repository root:

```sh
(cd backend && bun install --frozen-lockfile && bun run check && bun run build)
(cd backend && bun test server.test.ts)
(cd frontend && bun install --frozen-lockfile && bun run check && bun run build)
(cd backend/rust && cargo +1.99.1 fmt --check)
(cd backend/rust && cargo +1.99.1 check --locked --all-targets)
(cd backend/rust && cargo +1.99.1 test --locked --features test-utils --test claim)
```

The browser WASM build also needs wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129, and Clang 18; see [SETUP.md](SETUP.md).

## Browser acceptance evidence

On 2026-10-25, ChatGPT Browser exercised Horoi against public QEDIT ZSA testnet snapshot 7596: a real HCP1 proof was accepted, stateless verification returned `valid: true`, identical replay returned HTTP 409 `NULLIFIER_USED`, and a bit-tampered proof verified as `valid: false`. Browser Network inspection confirmed the submit body contained only claim ID, protocol version, proof, and alternate nullifier; no private key, note, balance, or witness was sent. A real-note insufficient-balance claim returned `NoEligibleNote` in browser WASM. Detailed measurements and limitations are in [PUBLIC_ZSA_E2E_REPORT.md](PUBLIC_ZSA_E2E_REPORT.md).
