# Horoi

Private ownership claims for Zcash Shielded Assets. Horoi is a ZECATHON Core & Tooling research prototype.

The current experimental implementation proves that one normal OrchardZSA note meets a threshold at a fixed snapshot. A Rust circuit binds the ZIP 227 AssetId, Orchard commitment root, public-nullifier exclusion root, claim domain, and claim-specific spend authorization. The browser scans public chain data and creates the proof locally; the backend verifies it and stores note-level replay state.

## Docker Judge Quickstart

Requirements: Git, Docker Engine, and Docker Compose v2. The default root Compose file is the zero-credential judge environment:

```bash
git clone https://github.com/riyannode/horoizec.git
cd horoizec
docker compose up --build
```

Open [http://localhost:3000/demo](http://localhost:3000/demo). The first build compiles Horoi's locked Rust verifier and production Next.js/Bun apps. No `.env`, wallet, RPC credentials, paid service, live chain scan, or new transaction is required. Only the frontend port is published; backend and SQLite stay on the isolated Compose network/volume.

The demo verifies a checked-in HCP1 proof fixture using the actual native Rust verifier, cryptographically rejects a one-byte-tampered copy, and exercises SQLite note-level replay protection. Its provenance is **LOCAL SYNTHETIC TEST FIXTURE**: the proof binds the `zebra-regtest` statement identifier and local Orchard test roots; it is not evidence from a Zebra node or public QEDIT testnet. The fixture route does not generate a new browser proof. The separate live `/claims/[id]` browser proving path remains in the existing app configuration.

Reset only the local judge state and its named volume with:

```bash
docker compose down -v --remove-orphans
```

The separate public Docker Compose profile and HTTPS reverse-proxy setup are documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The `/demo` route is a documented ZECATHON judge-walkthrough exception to the original five-route MVP PRD; the five existing routes remain in place.

## Evidence and limitations

A browser E2E recorded on 2026-10-25 accepted a real one-note HCP1 proof against public QEDIT ZSA testnet snapshot 7596. Stateless verification returned `valid: true`, replay returned HTTP 409 `NULLIFIER_USED`, a tampered proof returned `valid: false`, and the inspected submission body contained only public submission fields and the proof. The run is documented in [docs/PUBLIC_ZSA_E2E_REPORT.md](docs/PUBLIC_ZSA_E2E_REPORT.md); its exact runtime checkout SHA was not captured. It predates the later Worker experiment, which is not part of this baseline evidence and did not produce a positive proof.

This evidence covers one eligible note, not separate Alice/Bob holders. The `u64::MAX` `NoEligibleNote` run used the same test-wallet note data as a negative threshold case; it is not a second-holder demonstration. The proof does not aggregate multiple notes or support split notes.

Cold snapshot latency is unresolved. The historical baseline recorded 509,443 ms. Later local-only runs completed in 840,604–919,090 ms, while a separate latest request exceeded the 900,000 ms client boundary without an HTTP response; its server completion time was not captured. These runs were not a controlled comparison, so no reliable cold-path latency is claimed. The full public browser scan used 475 action-range requests and took about 1,410,512 ms. See the evidence report for measurements and limits.

The protocol is experimental and unaudited; do not use real funds. Mainnet is disabled.

See [docs/PRD.txt](docs/PRD.txt), [HOROI_AGENTS.md](HOROI_AGENTS.md), [docs/SETUP.md](docs/SETUP.md), [docs/CRYPTO.md](docs/CRYPTO.md), and [docs/TESTING.md](docs/TESTING.md).
