use std::io::{self, BufRead, Write};

use horoi_claim::{ClaimProof, ClaimProofError, ClaimSpec, ClaimVerifier, ExclusionTree};
#[cfg(not(target_arch = "wasm32"))]
use orchard::note::ExtractedNoteCommitment;
use serde_json::{Value, json};
#[cfg(not(target_arch = "wasm32"))]
use zcash_primitives::transaction::Transaction;
#[cfg(not(target_arch = "wasm32"))]
use zcash_protocol::consensus::BranchId;

fn string<'a>(request: &'a Value, key: &str) -> Result<&'a str, &'static str> {
    request
        .get(key)
        .and_then(Value::as_str)
        .ok_or("INVALID_REQUEST")
}

fn hex_bytes(value: &str) -> Result<Vec<u8>, &'static str> {
    let mut pairs = value.as_bytes().chunks_exact(2);
    let bytes = pairs
        .by_ref()
        .map(|pair| {
            let pair = std::str::from_utf8(pair).map_err(|_| "INVALID_REQUEST")?;
            u8::from_str_radix(pair, 16).map_err(|_| "INVALID_REQUEST")
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !pairs.remainder().is_empty() {
        return Err("INVALID_REQUEST");
    }
    Ok(bytes)
}

fn fixed_32(request: &Value, key: &str) -> Result<[u8; 32], &'static str> {
    hex_bytes(string(request, key)?)?
        .try_into()
        .map_err(|_| "INVALID_REQUEST")
}

fn claim_spec(request: &Value) -> Result<ClaimSpec, &'static str> {
    let expires_at = match request.get("expiresAt") {
        Some(Value::Null) | None => None,
        Some(Value::String(value)) => Some(value.parse().map_err(|_| "INVALID_REQUEST")?),
        _ => return Err("INVALID_REQUEST"),
    };
    let snapshot_height = request
        .get("snapshotHeight")
        .and_then(Value::as_u64)
        .and_then(|height| u32::try_from(height).ok())
        .ok_or("INVALID_REQUEST")?;
    let spec = ClaimSpec {
        network_id: string(&request, "networkId")?.to_owned(),
        asset_id: hex_bytes(string(&request, "assetId")?)?,
        threshold: string(&request, "threshold")?
            .parse()
            .map_err(|_| "INVALID_REQUEST")?,
        snapshot_height,
        commitment_root: fixed_32(&request, "commitmentRoot")?,
        exclusion_root: fixed_32(&request, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(&request, "creatorNonce")?,
    };
    spec.validate().map_err(|_| "INVALID_CLAIM")?;
    Ok(spec)
}

fn verify_request(request: Value) -> Result<Value, &'static str> {
    let spec = claim_spec(&request)?;
    let bundle = hex_bytes(string(&request, "proofBundle")?).map_err(|_| "INVALID_PROOF")?;
    let proof = ClaimProof::from_bytes(&bundle).map_err(|error| match error {
        ClaimProofError::UnsupportedVersion => "UNSUPPORTED_PROOF_VERSION",
        ClaimProofError::ProofTooLarge => "PROOF_TOO_LARGE",
        _ => "INVALID_PROOF",
    })?;
    ClaimVerifier::verify(&spec, &proof).map_err(|error| match error {
        ClaimProofError::SetupFailed => "VERIFIER_SETUP_FAILED",
        ClaimProofError::InvalidClaim(_) => "INVALID_CLAIM",
        ClaimProofError::UnsupportedVersion => "UNSUPPORTED_PROOF_VERSION",
        ClaimProofError::ProofTooLarge => "PROOF_TOO_LARGE",
        _ => "INVALID_PROOF",
    })?;
    let alternate_nullifier = proof.public_inputs()[0]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(json!({ "valid": true, "alternateNullifier": alternate_nullifier }))
}

fn validate_asset_request(request: Value) -> Result<Value, &'static str> {
    let asset_id = hex_bytes(string(&request, "assetId")?)?;
    let asset_base = horoi_claim::derive_asset_base(&asset_id).map_err(|_| "INVALID_ASSET_ID")?;
    let hex = |bytes: [u8; 32]| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    };
    Ok(json!({ "assetBase": hex(asset_base) }))
}

fn derive_request(request: Value) -> Result<Value, &'static str> {
    let spec = claim_spec(&request)?;
    let hex = |bytes: [u8; 32]| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    };
    Ok(json!({
        "claimId": hex(spec.claim_id().map_err(|_| "INVALID_CLAIM")?),
        "claimDomain": hex(spec.claim_domain().map_err(|_| "INVALID_CLAIM")?),
    }))
}

fn exclusion_root_request(request: Value) -> Result<Value, &'static str> {
    let nullifiers = request
        .get("nullifiers")
        .and_then(Value::as_array)
        .ok_or("INVALID_REQUEST")?
        .iter()
        .map(|value| {
            let value = value.as_str().ok_or("INVALID_REQUEST")?;
            hex_bytes(value)?
                .try_into()
                .map_err(|_| "INVALID_NULLIFIER")
        })
        .collect::<Result<Vec<[u8; 32]>, _>>()?;
    let tree = ExclusionTree::from_nullifiers(nullifiers).map_err(|_| "INVALID_NULLIFIER")?;
    let root = tree
        .root()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(json!({ "exclusionRoot": root }))
}

#[cfg(not(target_arch = "wasm32"))]
fn issuance_notes_request(request: Value) -> Result<Value, &'static str> {
    let transactions = request
        .get("transactions")
        .and_then(Value::as_array)
        .ok_or("INVALID_REQUEST")?;
    let notes_by_transaction = transactions
        .iter()
        .map(|transaction| {
            let bytes = hex_bytes(transaction.as_str().ok_or("INVALID_REQUEST")?)?;
            let transaction = Transaction::read(bytes.as_slice(), BranchId::Nu6)
                .map_err(|_| "INVALID_TRANSACTION")?;
            let data = transaction.into_data();
            let mut notes = Vec::new();
            if let Some(bundle) = data.issue_bundle() {
                for action in bundle.actions() {
                    let mut asset_id = Vec::with_capacity(66);
                    asset_id.push(0);
                    asset_id.extend_from_slice(&bundle.ik().encode());
                    asset_id.extend_from_slice(action.asset_desc_hash());
                    let asset_base = horoi_claim::derive_asset_base(&asset_id)
                        .map_err(|_| "INVALID_TRANSACTION")?;
                    for note in action.notes() {
                        let hex = |bytes: &[u8]| {
                            bytes
                                .iter()
                                .map(|byte| format!("{byte:02x}"))
                                .collect::<String>()
                        };
                        let cmx = ExtractedNoteCommitment::from(note.commitment()).to_bytes();
                        let recipient = note.recipient().to_raw_address_bytes();
                        let rho = note.rho().to_bytes();
                        notes.push(json!({
                            "cmx": hex(&cmx),
                            "assetBase": hex(&asset_base),
                            "recipient": hex(&recipient),
                            "value": note.value().inner().to_string(),
                            "rho": hex(&rho),
                            "rseed": hex(note.rseed().as_bytes()),
                        }));
                    }
                }
            }
            Ok(notes)
        })
        .collect::<Result<Vec<Vec<Value>>, _>>()?;
    Ok(json!({ "issuanceNotes": notes_by_transaction }))
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(request) => match request.get("operation").and_then(Value::as_str) {
                    Some("validateAsset") => validate_asset_request(request)
                        .unwrap_or_else(|code| json!({ "errorCode": code })),
                    Some("deriveClaim") => {
                        derive_request(request).unwrap_or_else(|code| json!({ "errorCode": code }))
                    }
                    Some("exclusionRoot") => exclusion_root_request(request)
                        .unwrap_or_else(|code| json!({ "errorCode": code })),
                    #[cfg(not(target_arch = "wasm32"))]
                    Some("issuanceNotes") => issuance_notes_request(request)
                        .unwrap_or_else(|code| json!({ "errorCode": code })),
                    _ => verify_request(request)
                        .unwrap_or_else(|code| json!({ "valid": false, "errorCode": code })),
                },
                Err(_) => json!({ "valid": false, "errorCode": "INVALID_REQUEST" }),
            },
            Err(_) => json!({ "valid": false, "errorCode": "INVALID_REQUEST" }),
        };
        if serde_json::to_writer(&mut output, &response).is_err()
            || writeln!(output).is_err()
            || output.flush().is_err()
        {
            break;
        }
    }
}
