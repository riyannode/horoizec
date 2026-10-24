use ff::PrimeField;
use wasm_bindgen::prelude::*;

use crate::{
    ClaimProof, ClaimSpec, EXCLUSION_TREE_DEPTH, ExclusionInterval, ExclusionWitness,
    create_spend_authorization, derive_asset_base, prove_scanned_single_note_claim,
    prove_single_note_claim,
};
use orchard::keys::SpendingKey;
use pasta_curves::pallas;

fn fixed_32(bytes: Vec<u8>, field: &str) -> Result<[u8; 32], JsValue> {
    bytes
        .try_into()
        .map_err(|_| JsValue::from_str(&format!("{field} must be exactly 32 bytes")))
}

fn hex(bytes: [u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[wasm_bindgen]
pub fn claim_proof_alternate_nullifier(proof_bytes: Vec<u8>) -> Result<String, JsValue> {
    let proof = ClaimProof::from_bytes(&proof_bytes)
        .map_err(|error| JsValue::from_str(&format!("invalid claim proof: {error:?}")))?;
    Ok(hex(*proof.public_inputs().first().ok_or_else(|| {
        JsValue::from_str("claim proof has no alternate nullifier")
    })?))
}

#[wasm_bindgen]
pub fn derive_claim_id(
    network_id: String,
    asset_id: Vec<u8>,
    threshold: u64,
    snapshot_height: u32,
    commitment_root: Vec<u8>,
    exclusion_root: Vec<u8>,
    expires_at: Option<u64>,
    creator_nonce: Vec<u8>,
) -> Result<String, JsValue> {
    let spec = ClaimSpec {
        network_id,
        asset_id,
        threshold,
        snapshot_height,
        commitment_root: fixed_32(commitment_root, "commitmentRoot")?,
        exclusion_root: fixed_32(exclusion_root, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(creator_nonce, "creatorNonce")?,
    };
    spec.claim_id()
        .map(hex)
        .map_err(|error| JsValue::from_str(&format!("invalid claim: {error:?}")))
}

#[wasm_bindgen]
pub fn derive_claim_domain(
    network_id: String,
    asset_id: Vec<u8>,
    threshold: u64,
    snapshot_height: u32,
    commitment_root: Vec<u8>,
    exclusion_root: Vec<u8>,
    expires_at: Option<u64>,
    creator_nonce: Vec<u8>,
) -> Result<String, JsValue> {
    let spec = ClaimSpec {
        network_id,
        asset_id,
        threshold,
        snapshot_height,
        commitment_root: fixed_32(commitment_root, "commitmentRoot")?,
        exclusion_root: fixed_32(exclusion_root, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(creator_nonce, "creatorNonce")?,
    };
    spec.claim_domain()
        .map(hex)
        .map_err(|error| JsValue::from_str(&format!("invalid claim: {error:?}")))
}

#[wasm_bindgen]
pub fn derive_zsa_asset_base(asset_id: Vec<u8>) -> Result<String, JsValue> {
    let asset_base = derive_asset_base(&asset_id)
        .map_err(|error| JsValue::from_str(&format!("invalid asset ID: {error:?}")))?;
    Ok(hex(asset_base))
}

#[wasm_bindgen]
pub fn derive_claim_public_inputs(
    network_id: String,
    asset_id: Vec<u8>,
    threshold: u64,
    snapshot_height: u32,
    commitment_root: Vec<u8>,
    exclusion_root: Vec<u8>,
    expires_at: Option<u64>,
    creator_nonce: Vec<u8>,
    alternate_nullifier: Vec<u8>,
    randomized_spend_key: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    let spec = ClaimSpec {
        network_id,
        asset_id,
        threshold,
        snapshot_height,
        commitment_root: fixed_32(commitment_root, "commitmentRoot")?,
        exclusion_root: fixed_32(exclusion_root, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(creator_nonce, "creatorNonce")?,
    };
    let inputs = spec
        .circuit_public_inputs(
            fixed_32(alternate_nullifier, "alternateNullifier")?,
            fixed_32(randomized_spend_key, "randomizedSpendKey")?,
        )
        .map_err(|error| JsValue::from_str(&format!("invalid claim inputs: {error:?}")))?;
    Ok(inputs
        .into_iter()
        .flat_map(|field| field.to_repr())
        .collect())
}

#[wasm_bindgen]
pub fn derive_spend_authorization_message(
    network_id: String,
    asset_id: Vec<u8>,
    threshold: u64,
    snapshot_height: u32,
    commitment_root: Vec<u8>,
    exclusion_root: Vec<u8>,
    expires_at: Option<u64>,
    creator_nonce: Vec<u8>,
    alternate_nullifier: Vec<u8>,
) -> Result<String, JsValue> {
    let spec = ClaimSpec {
        network_id,
        asset_id,
        threshold,
        snapshot_height,
        commitment_root: fixed_32(commitment_root, "commitmentRoot")?,
        exclusion_root: fixed_32(exclusion_root, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(creator_nonce, "creatorNonce")?,
    };
    spec.spend_authorization_message(fixed_32(alternate_nullifier, "alternateNullifier")?)
        .map(hex)
        .map_err(|error| JsValue::from_str(&format!("invalid claim inputs: {error:?}")))
}

#[wasm_bindgen]
pub fn sign_spend_authorization(
    spending_key: Vec<u8>,
    randomizer: Vec<u8>,
    message: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    let spending_key_bytes = fixed_32(spending_key, "spendingKey")?;
    let spending_key = Option::<SpendingKey>::from(SpendingKey::from_bytes(spending_key_bytes))
        .ok_or_else(|| JsValue::from_str("invalid spending key"))?;
    let randomizer_bytes = fixed_32(randomizer, "randomizer")?;
    let randomizer = Option::<pallas::Scalar>::from(pallas::Scalar::from_repr(randomizer_bytes))
        .ok_or_else(|| JsValue::from_str("invalid spend authorization randomizer"))?;
    let (randomized_spend_key, signature) =
        create_spend_authorization(&spending_key, &randomizer, &message).map_err(|error| {
            JsValue::from_str(&format!("spend authorization failed: {error:?}"))
        })?;
    Ok(randomized_spend_key.into_iter().chain(signature).collect())
}

#[wasm_bindgen]
pub fn prove_single_note_claim_wasm(
    network_id: String,
    asset_id: Vec<u8>,
    threshold: u64,
    snapshot_height: u32,
    commitment_root: Vec<u8>,
    exclusion_root: Vec<u8>,
    expires_at: Option<u64>,
    creator_nonce: Vec<u8>,
    spending_key: Vec<u8>,
    value: u64,
    rho: Vec<u8>,
    rseed: Vec<u8>,
    diversifier_index: u32,
    scope: u8,
    merkle_position: u32,
    merkle_path: Vec<u8>,
    exclusion_low: Vec<u8>,
    exclusion_width: Vec<u8>,
    exclusion_position: u32,
    exclusion_path: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    let spec = ClaimSpec {
        network_id,
        asset_id,
        threshold,
        snapshot_height,
        commitment_root: fixed_32(commitment_root, "commitmentRoot")?,
        exclusion_root: fixed_32(exclusion_root, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(creator_nonce, "creatorNonce")?,
    };
    if exclusion_path.len() != 32 * EXCLUSION_TREE_DEPTH {
        return Err(JsValue::from_str("exclusionPath has an invalid length"));
    }
    let mut auth_path = [[0; 32]; EXCLUSION_TREE_DEPTH];
    for (node, chunk) in auth_path.iter_mut().zip(exclusion_path.chunks_exact(32)) {
        node.copy_from_slice(chunk);
        if Option::<pallas::Base>::from(pallas::Base::from_repr(*node)).is_none() {
            return Err(JsValue::from_str(
                "exclusionPath contains a noncanonical field",
            ));
        }
    }
    let exclusion_witness = ExclusionWitness {
        interval: ExclusionInterval {
            low: fixed_32(exclusion_low, "exclusionLow")?,
            width: fixed_32(exclusion_width, "exclusionWidth")?,
        },
        position: exclusion_position,
        auth_path,
    };
    prove_single_note_claim(
        &spec,
        fixed_32(spending_key, "spendingKey")?,
        value,
        fixed_32(rho, "rho")?,
        fixed_32(rseed, "rseed")?,
        diversifier_index,
        scope,
        merkle_position,
        &merkle_path,
        exclusion_witness,
    )
    .map_err(|error| JsValue::from_str(&format!("proof generation failed: {error:?}")))
}

#[wasm_bindgen]
pub fn scan_and_prove_single_note_claim_wasm(
    network_id: String,
    asset_id: Vec<u8>,
    threshold: u64,
    snapshot_height: u32,
    commitment_root: Vec<u8>,
    exclusion_root: Vec<u8>,
    expires_at: Option<u64>,
    creator_nonce: Vec<u8>,
    spending_key: Vec<u8>,
    packed_actions: Vec<u8>,
) -> Result<Vec<u8>, JsValue> {
    let spec = ClaimSpec {
        network_id,
        asset_id,
        threshold,
        snapshot_height,
        commitment_root: fixed_32(commitment_root, "commitmentRoot")?,
        exclusion_root: fixed_32(exclusion_root, "exclusionRoot")?,
        expires_at,
        creator_nonce: fixed_32(creator_nonce, "creatorNonce")?,
    };
    prove_scanned_single_note_claim(
        &spec,
        fixed_32(spending_key, "spendingKey")?,
        &packed_actions,
    )
    .map_err(|error| JsValue::from_str(&format!("scan or proof generation failed: {error:?}")))
}
