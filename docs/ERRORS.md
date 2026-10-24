# Error codes

HTTP errors use { "error": { "code": "...", "message": "...", "requestId": "..." } }. A cryptographically invalid proof sent to the stateless verify route returns HTTP 200 with valid=false; submission rejects it with PROOF_INVALID.

| Code | HTTP | Cause and safe retry behavior | User-facing message | Operator action |
| --- | --- | --- | --- | --- |
| BAD_REQUEST | 400 | JSON or fields do not match schema; correct the request. | The request is invalid. | Inspect route and status metadata; do not log the body. |
| INVALID_ASSET_ID | 400 | AssetId encoding is invalid; correct it. | The AssetId is invalid. | Check encoding. |
| INVALID_THRESHOLD | 400 | Threshold is not a positive u64 decimal; correct it. | The threshold must be a positive integer. | Check submitted value. |
| INVALID_SNAPSHOT | 400 | Height or range is invalid or beyond tip; correct it. | The snapshot height is invalid. | Check request and node height. |
| NETWORK_MISMATCH | 400 | Node does not match configured test network or pinned regtest identity; retry only with intended node. | The configured node is not the selected testnet or regtest network. | Check NETWORK_ID, genesis, and node config. |
| ZSA_UNSUPPORTED | 400 | NU7 is not active on selected chain; retry after activation/configuration. | The configured chain has not activated OrchardZSA support. | Check upgrade status and network. |
| MAINNET_DISABLED | 403 | Mainnet is outside prototype scope; do not retry there. | Mainnet is disabled for this prototype. | Use configured testnet or regtest. |
| CLAIM_NOT_FOUND | 404 | No claim has that ID; retry only with corrected ID. | The claim was not found. | Check local DB and ID. |
| CLAIM_EXPIRED | 410 | Expiry has passed; create a new claim. | The claim has expired. | Check expiry configuration. |
| SNAPSHOT_STALE | 409 | Stored roots or network no longer match active chain; create a new claim. | The claim snapshot no longer matches the active chain. | Check for reset, reorg, or DB/network mismatch. |
| NULLIFIER_USED | 409 | Same alternate nullifier was already consumed in this claim; do not retry unchanged input. | These notes have already been used in this claim. | Check DB integrity if unexpected. |
| PROOF_INPUT_MISMATCH | 400 | Proof metadata or alternate nullifier differs from stored statement; correct the bundle. | The proof does not match this claim. | Check protocol version and public statement without logging proof contents. |
| PROOF_INVALID | 400 | Native verifier rejected submitted proof; do not retry unchanged input. | The proof could not be verified. | Check verifier build and statement binding. |
| SNAPSHOT_UNAVAILABLE | 503 | RPC returned inconsistent roots or canonical history; retry after node/index recovery. | The requested snapshot is unavailable. | Check RPC, block decoding, and chain continuity. |
| ZCASH_RPC_UNAVAILABLE | 503 | Configured node could not be read; retry after recovery. | The configured Zcash node is unavailable. | Check endpoint and RPC credentials. |
| VERIFIER_UNAVAILABLE | 503 | Native Rust verifier process is unavailable; retry after recovery. | The local Rust verifier is unavailable. | Check binary path and process startup. |

No raw cryptographic stack trace or private wallet material is returned in HTTP errors or normal logs. Unknown internal errors currently map to BAD_REQUEST; this is a known limitation of the current centralized error mapper.
