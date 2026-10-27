# Horoi

Private ownership claims for Zcash Shielded Assets. Horoi is a ZECATHON Core & Tooling research prototype.

The current experimental implementation proves that one normal OrchardZSA note meets a threshold at a fixed snapshot. A Rust circuit binds the ZIP 227 AssetId, Orchard commitment root, public-nullifier exclusion root, claim domain, and claim-specific spend authorization. The browser scans public chain data and creates the proof locally; the backend verifies it and stores note-level replay state.

## Evaluation paths

| Surface | URL or command | Evidence boundary |
| --- | --- | --- |
| Public application | [https://horoi.kima.my.id](https://horoi.kima.my.id) | Public testnet application backed by the live API service. A fresh browser-generated proof on the corrected release remains unverified. |
| Public synthetic fixture | [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo) | Native HCP1 verification, tamper rejection, and isolated SQLite replay using the labeled local synthetic fixture. |
| Local Judge | `docker compose up --build`, then [http://localhost:3000/demo](http://localhost:3000/demo) | Zero-credential synthetic Judge environment; its backend cannot reach public RPC. |

These are separate routes and backend services. The fixture walkthrough does not establish a live-chain proof. Historical public QEDIT testnet proof acceptance is documented below and in [docs/PUBLIC_ZSA_E2E_REPORT.md](docs/PUBLIC_ZSA_E2E_REPORT.md); it is not a new proof from the corrected release.

## Docker Judge Quickstart

Requirements: Git, Docker Engine, and Docker Compose v2. The default root Compose file is the zero-credential judge environment:

```bash
git clone https://github.com/riyannode/horoizec.git
cd horoizec
docker compose up --build
```

Open [http://localhost:3000/demo](http://localhost:3000/demo). The hosted public Docker demo is [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo); it uses the same public synthetic HCP1 fixture, not a live QEDIT testnet proof. The first build compiles Horoi's locked Rust verifier and production Next.js/Bun apps. No `.env`, wallet, RPC credentials, paid service, live chain scan, or new transaction is required. Only the frontend port is published; backend and SQLite stay on the isolated Compose network/volume.

The demo verifies a checked-in HCP1 proof fixture using the actual native Rust verifier, cryptographically rejects a one-byte-tampered copy, and exercises SQLite note-level replay protection. The replay walkthrough uses a temporary SQLite database per run, verifies the genuine proof twice, and does not consume or reset shared judge state. Its provenance is **LOCAL SYNTHETIC TEST FIXTURE**: the proof binds the `zebra-regtest` statement identifier and local Orchard test roots; it is not evidence from a Zebra node or public QEDIT testnet. The fixture route does not generate a new browser proof. The separate live `/claims/[id]` browser proving path remains in the existing app configuration.

Reset only the local judge state and its named volume with:

```bash
docker compose down -v --remove-orphans
```

Horoi has three runtime surfaces: the local synthetic Judge, a public testnet API, and a separate public synthetic demo. Their networks, volumes, routes, resource bounds, and commands are documented in [docs/THREE_SURFACES.md](docs/THREE_SURFACES.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The `/demo` route is a documented ZECATHON judge-walkthrough exception to the original five-route MVP PRD; the five existing routes remain in place.

## Evidence and limitations

A browser E2E recorded on 2026-10-25 accepted a real one-note HCP1 proof against public QEDIT ZSA testnet snapshot 7596. Stateless verification returned `valid: true`, replay returned HTTP 409 `NULLIFIER_USED`, a tampered proof returned `valid: false`, and the inspected submission body contained only public submission fields and the proof. The run is documented in [docs/PUBLIC_ZSA_E2E_REPORT.md](docs/PUBLIC_ZSA_E2E_REPORT.md); its exact runtime checkout SHA was not captured. It predates the later Worker experiment, which is not part of this baseline evidence and did not produce a positive proof.

This evidence covers one eligible note, not separate Alice/Bob holders. The `u64::MAX` `NoEligibleNote` run used the same test-wallet note data as a negative threshold case; it is not a second-holder demonstration. The proof does not aggregate multiple notes or support split notes.

Cold snapshot reliability is unresolved. Historical snapshots completed in 509,443–919,090 ms, and the historical full browser action scan took about 1,410,512 ms. An earlier claim request closed after 30,002 ms during `snapshot_scan`; the owner of that connection close remains unproven. A later public async claim job returned HTTP 202 and polled with HTTP 200, then failed before insertion with `SNAPSHOT_UNAVAILABLE` after about 11m24s. The public job status did not identify the failing RPC method or block. Bounded probes afterward were responsive but do not establish full-scan reliability. A local checkpoint/resume change is not deployed. No cold-path performance guarantee is claimed. See [docs/PUBLIC_ZSA_E2E_REPORT.md](docs/PUBLIC_ZSA_E2E_REPORT.md) for exact evidence.

The protocol is experimental and unaudited; do not use real funds. Mainnet is disabled.

See [docs/PRD.txt](docs/PRD.txt), [HOROI_AGENTS.md](HOROI_AGENTS.md), [docs/SETUP.md](docs/SETUP.md), [docs/CRYPTO.md](docs/CRYPTO.md), and [docs/TESTING.md](docs/TESTING.md).
