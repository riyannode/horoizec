# Horoi

Private ownership claims for Zcash Shielded Assets. Horoi is a ZECATHON Core & Tooling research prototype.

The current experimental implementation proves that one normal OrchardZSA note meets a threshold at a fixed snapshot. A Rust circuit binds the ZIP 227 AssetId, Orchard commitment root, public-nullifier exclusion root, claim domain, and claim-specific spend authorization. The browser scans public chain data and creates the proof locally; the backend verifies it and stores note-level replay state.

A one-note browser proof and replay flow passed on a pinned local QEDIT Zebra regtest fixture. Public ZSA testnet proof acceptance has not been verified. The proof does not aggregate multiple notes or support split notes. The protocol is experimental and unaudited; do not use real funds. Mainnet is disabled.

See [docs/PRD.txt](docs/PRD.txt), [HOROI_AGENTS.md](HOROI_AGENTS.md), [docs/SETUP.md](docs/SETUP.md), [docs/CRYPTO.md](docs/CRYPTO.md), and [docs/TESTING.md](docs/TESTING.md).
