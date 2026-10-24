# AGENTS.md — Horoi

## Mission

Implement `docs/PRD.txt` completely and correctly before any remote push.

Horoi is a ZSA ownership-claim primitive, not a launchpad, exchange, wallet,
bridge, or EVM application.

Core thesis:

> Private assets need private composability.

Core statement:

> Prove that a holder met a ZSA balance threshold at a fixed snapshot without
> revealing exact balance, wallet address, private notes, or unrelated history.

## Repository Shape

Only these top-level directories are allowed:

- `backend/`
- `frontend/`
- `docs/`

Root files such as `AGENTS.md`, `.gitignore`, and repository metadata are fine.

Do not create additional top-level project directories such as `packages/`,
`contracts/`, `shared/`, `scripts/`, or `infra/`.

## Mandatory WSL Execution Environment

The coding agent may be launched from native Windows, but Horoi development MUST
run inside WSL/Linux.

Do not implement, install dependencies, build, test, commit, or push using:

- PowerShell;
- `cmd.exe`;
- Windows-native Git;
- Windows-native Bun/Node;
- Windows-native Rust/Cargo.

If the agent process starts on Windows, enter WSL before doing project work.

Preferred invocation pattern from Windows:

    wsl.exe -- bash -lc '<command>'

If a specific distro is required:

    wsl.exe -d <distro> -- bash -lc '<command>'

Keep the working repository inside the WSL Linux filesystem, for example:

    ~/src/horoi

Prefer this over:

    C:\...
    /mnt/c/...
    /mnt/d/...

Do not edit one checkout from both Windows and WSL.

Inside WSL:

1. verify with `uname -a`;
2. verify the repository path with `pwd`;
3. verify `git`, `bun`, `cargo`, and `rustc` resolve to Linux executables;
4. install/use project dependencies inside WSL only;
5. run all build/check/test/git commands inside WSL;
6. run the development servers from WSL.

For browser validation, expose the WSL application on a host reachable by the
browser, normally `0.0.0.0` with the documented development port. Browser
testing may be driven from ChatGPT/Windows, but the application process itself
must remain inside WSL.

Before the final commit/push report, include:

    uname -a
    pwd
    which git
    which bun
    which cargo
    which rustc

as evidence that implementation and release checks were performed in WSL.

If WSL is unavailable or broken, stop and report that as an environment blocker.
Do not silently fall back to native Windows.

## Mandatory Read Order

Before writing code:

1. Read `docs/PRD.txt` completely.
2. Inspect the current repository and all existing files.
3. Read the official upstream coding-agent guidance relevant to the code being used:
   - `zcash/orchard/AGENTS.md`
   - `zcash/librustzcash/AGENTS.md`
   - `ZcashFoundation/zebra/AGENTS.md`
   - `zcash/zips/AGENTS.md`
4. Read:
   - ZIP 226
   - ZIP 227
   - `draft-str4d-orchard-balance-proof.md`
5. Inspect the active QEDIT ZSA implementation and pin exact revisions.
6. Inspect `QED-it/zcash_tx_tool` for the real OrchardZSA transaction/testnet workflow.
7. Inspect `cachet-zec/cachet` only as a reference for ZSA testnet integration,
   browser-local WASM/proving, dependency pinning, and privacy boundaries.

Do not start implementation until the dependency map is known.

## Research Policy

Do not perform broad web scraping by default.

Use this priority order:

1. local repository;
2. pinned upstream source code;
3. official Zcash ZIP/spec;
4. official Zcash repository documentation;
5. QEDIT ZSA source/test tooling;
6. Cachet reference implementation;
7. targeted web lookup only when the above sources cannot resolve a concrete blocker.

Never guess an upstream API.

If documentation and source disagree, source at the pinned revision wins and the
difference must be documented.

Record every non-release git dependency by exact commit SHA.

## Upstream Contribution Note

The official Zcash `AGENTS.md` files contain contribution gates for PRs to those
upstream repositories. Horoi is its own repository, so those upstream PR gates
do not apply unless this task actually modifies or opens a PR against the
upstream Zcash repository.

Their coding/security conventions remain relevant.

## Implementation Order

### Phase 0 — Dependency Proof

Before product code:

- identify the active ZSA test environment;
- pin OrchardZSA/QEDIT revisions;
- pin compatible librustzcash and Zebra revisions;
- reproduce the minimal ZSA transaction flow;
- document exact commands and SHAs in `docs/SETUP.md`.

If this cannot be reproduced, stop implementation and report the exact blocker.
Do not fake ZSA behavior.

### Phase 1 — Rust Claim Core

Implement the cryptographic source of truth first:

- canonical claim encoding;
- claim ID;
- claim domain;
- AssetId binding;
- snapshot binding;
- threshold semantics;
- alternate-nullifier derivation;
- `ClaimCircuit`;
- `ClaimProof`;
- `ClaimVerifier`.

Keep ZSA/QEDIT-specific types localized to the ZSA boundary.

Do not duplicate this logic in TypeScript.

### Phase 2 — Browser WASM

Build the same Rust claim implementation for browser use.

Private witness creation and proving stay local.

The browser must never upload:

- seed phrase;
- spending key;
- full viewing key;
- exact private balance;
- decrypted private notes.

### Phase 3 — Bun Backend

Implement only the backend responsibilities in the PRD:

- SQLite;
- claims;
- snapshots/public chain data;
- stateless proof verification;
- stateful claim submission;
- atomic nullifier consumption;
- stable error codes.

Do not add user accounts, custody, balances, wallets, or analytics.

### Phase 4 — Minimal Frontend

Implement only:

- `/`
- `/claims`
- `/claims/[id]`
- `/create`
- `/verify`

Keep styling minimal.

Do not spend time on final visual design.

### Phase 5 — Validation

Automated tests:

- one Rust integration test file: `backend/rust/tests/claim.rs`;
- no Playwright;
- no Cypress;
- no Vitest/Jest frontend suite unless the user explicitly changes this rule.

Run:

- Bun install with frozen lockfiles;
- TypeScript checks;
- production builds;
- `cargo fmt --check`;
- `cargo check --locked`;
- the single Rust protocol test target.

Then validate the real UI in ChatGPT Browser.

The browser validation must inspect network requests and confirm private witness
material is not transmitted.

### Phase 6 — Documentation

Complete and reconcile:

- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/CRYPTO.md`
- `docs/ERRORS.md`
- `docs/SECURITY.md`
- `docs/SETUP.md`
- `docs/TESTING.md`
- `docs/HACKATHON.md`
- `docs/REFERENCES.md`

Documentation must describe implemented behavior, not planned behavior.

## Coding Rules

- Prefer simple domain names.
- Do not create generic `manager`, `engine`, `orchestrator`, `service`,
  `repository`, `utils`, or `helpers` layers without a concrete need.
- Do not create many tiny files.
- Do not duplicate schemas or cryptographic rules.
- Do not use JavaScript floating point for asset values.
- Use decimal strings at HTTP boundaries and checked integer types internally.
- Fail closed.
- Do not use `any` for untrusted TypeScript boundaries.
- Do not use `unwrap()`/`expect()` on untrusted Rust runtime input.
- Do not invent custom cryptography when upstream primitives exist.
- Do not add Solidity or an EVM contract.
- Do not log proof bodies or wallet-sensitive material.
- Do not persist full submitted proofs unless the PRD is explicitly changed.

## Critical Semantic Rule

MVP replay protection is note-level within a claim domain.

Correct:

> The same contributing note cannot be reused after its alternate nullifier is
> accepted in the same claim domain.

Incorrect:

> One user can claim only once.

Incorrect:

> One wallet can claim only once.

Do not overclaim this property in code, UI, README, or hackathon copy.

## No Fake Completion

A TODO, mocked proof, fake verifier, hard-coded valid result, or database-only
ownership check does not satisfy the PRD.

If a cryptographic requirement cannot be completed, report it as incomplete.

## Push Gate

Do not push to the remote repository while any acceptance criterion in
`docs/PRD.txt` is unresolved.

Before push, produce a final completion report with:

1. PRD acceptance criteria: PASS/FAIL one by one.
2. exact pinned ZSA/QEDIT SHAs.
3. build/check/test commands and results.
4. ChatGPT Browser validation result.
5. known limitations.
6. `git status`.
7. `git diff --check`.
8. confirmation that no secrets are tracked.
9. confirmation that docs match implementation.

Remote push is allowed only after every required MVP gate is PASS.

If ChatGPT Browser validation is performed in a separate ChatGPT session, stop
at `RELEASE_CANDIDATE` and do not push until that browser result is provided as
PASS.

## Final Push

After all gates pass:

- ensure the working tree contains only intended changes;
- commit with a clear message;
- push the implementation branch once;
- report branch, commit SHA, and remote push result.

Do not deploy or merge unless separately requested.
