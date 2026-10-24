# Testing and validation

All Horoi commands run in WSL/Linux. Cryptographic invariants stay in the single Rust integration test file; backend/frontend behavior uses typecheck and production builds; UI/E2E behavior is checked manually in ChatGPT Browser. UI and end-to-end validation uses ChatGPT Browser. The repository does not carry Playwright/Cypress/Vitest frontend test suites.

## Commands

From the repository root:

```sh
cd backend && bun install --frozen-lockfile && bun run check && bun run build
cd ../frontend && bun install --frozen-lockfile && bun run check && bun run build
cd ../backend/rust
cargo +1.99.1 fmt --check
cargo +1.99.1 check --locked --all-targets
cargo +1.99.1 test --locked --features test-utils --test claim
```

The browser WASM build also needs wasm32-unknown-unknown, wasm-bindgen-cli 0.2.129, and Clang 18; see [SETUP.md](SETUP.md).

## Browser acceptance evidence

On 2026-10-22, ChatGPT Browser exercised the local QEDIT Zebra regtest: issued-note reconstruction, browser WASM proof generation, API acceptance, repeated submission returning HTTP 409, verification returning VALID, and tampered proof returning INVALID. The backend received only the proof and alternate nullifier after scanning public chain data. This proves a local fixture flow, not public testnet acceptance.

The remaining public-testnet acceptance run must use a real eligible testnet note and inspect browser Network requests for absence of seed phrase, spending key, viewing key, exact balance, decrypted note, and witness data. Testnet E2E remains unverified. Do not add a frontend test automation suite to substitute for ChatGPT Browser.
