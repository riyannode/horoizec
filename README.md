# Horoi

Private ownership claims for Zcash Shielded Assets. Horoi is a ZECATHON Core & Tooling research prototype.

The current experimental implementation proves that one normal OrchardZSA note meets a threshold at a fixed snapshot. A Rust circuit binds the ZIP 227 AssetId, Orchard commitment root, public-nullifier exclusion root, claim domain, and claim-specific spend authorization. The browser scans public chain data and creates the proof locally; the backend verifies it and stores note-level replay state.

## Evaluation paths

| Surface | URL or command | Evidence boundary |
| --- | --- | --- |
| Public application | [https://horoi.kima.my.id](https://horoi.kima.my.id) | Public testnet application backed by the live API service. A fresh one-note proof for snapshot 8457 was accepted by the live verifier on 2026-10-28; the strict ChatGPT Browser criterion is recorded separately. |
| Public synthetic fixture | [https://horoi.kima.my.id/demo](https://horoi.kima.my.id/demo) | Native HCP1 verification, tamper rejection, and isolated SQLite replay using the labeled local synthetic fixture. |
| Local Judge | `docker compose up --build`, then [http://localhost:3000/demo](http://localhost:3000/demo) | Zero-credential synthetic Judge environment; its backend cannot reach public RPC. |

These are separate routes and backend services. The fixture walkthrough does not establish a live-chain proof. The fresh snapshot-8457 proof and the historical snapshot-7596 proof are documented separately in [docs/PUBLIC_ZSA_E2E_REPORT.md](docs/PUBLIC_ZSA_E2E_REPORT.md).

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

An earlier async snapshot job failed after about 11m24s, followed by a successful retry that persisted claim c19b11d72b79fab77b21942e031ae52ac177550a9a19de3a3ecee0fb1a40060e at canonical height 8457. On 2026-10-28 the deployed 59ade00 source completed a fresh proof job for that claim: all 529 public 16-block action ranges were present, the live verifier accepted a 5,640-byte HCP1 proof, stateless verification returned `valid: true`, replay returned HTTP 409 `NULLIFIER_USED`, and tampering returned `valid: false`. The browser was WSL Chromium; it was not the ChatGPT in-app browser, so the strict §24.I criterion remains partial. This single completed run is not a cold-path reliability guarantee. See [docs/PUBLIC_ZSA_E2E_REPORT.md](docs/PUBLIC_ZSA_E2E_REPORT.md) for the full evidence and limitations.

The protocol is experimental and unaudited; do not use real funds. Mainnet is disabled.

See [docs/PRD.txt](docs/PRD.txt), [HOROI_AGENTS.md](HOROI_AGENTS.md), [docs/SETUP.md](docs/SETUP.md), [docs/CRYPTO.md](docs/CRYPTO.md), and [docs/TESTING.md](docs/TESTING.md).
