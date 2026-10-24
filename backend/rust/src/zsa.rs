use crate::{
    ClaimProof, ClaimProofError, ClaimSpec, EXCLUSION_TREE_DEPTH, ExclusionWitness,
    verify_exclusion_witness,
};
use ff::{Field, PrimeField};
use group::Curve;
use halo2_gadgets::{
    ecc::{
        CircuitVersion, FixedPoint, FixedPointBaseField, NonIdentityPoint, ScalarFixed, ScalarVar,
        chip::{EccChip, EccConfig},
    },
    poseidon::{Hash as PoseidonHash, Pow5Chip, Pow5Config},
    sinsemilla::{
        chip::{SinsemillaChip, SinsemillaConfig},
        merkle::{
            MerklePath as CircuitMerklePath,
            chip::{MerkleChip, MerkleConfig},
        },
    },
    utilities::{
        cond_swap::{CondSwapChip, CondSwapConfig, CondSwapInstructions},
        lookup_range_check::{LookupRangeCheck, PallasLookupRangeCheck4_5BConfig},
    },
};
use halo2_poseidon::{ConstantLength, Hash, P128Pow5T3};
use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    plonk::{
        Advice, Circuit, Column, ConstraintSystem, Constraints, Error, Expression, Instance,
        Selector,
    },
    poly::Rotation,
};
use incrementalmerkletree::{
    frontier::{CommitmentTree, Frontier},
    witness::IncrementalWitness,
};
use orchard::{
    Address,
    circuit::{
        commit_ivk::{CommitIvkChip, CommitIvkConfig, gadgets::commit_ivk},
        gadget::{
            AddInstruction,
            add_chip::{AddChip, AddConfig},
            assign_free_advice, assign_is_zatoshi_asset,
        },
        note_commit::{
            NoteCommitChip, NoteCommitConfig, ZsaNoteCommitParams, gadgets::note_commit,
        },
    },
    constants::{
        NullifierK, OrchardCommitDomains, OrchardFixedBases, OrchardFixedBasesFull,
        OrchardHashDomains,
    },
    flavor::OrchardZSA,
    issuance::auth::{IssueValidatingKey, ZSASchnorr},
    keys::{
        FullViewingKey, PreparedIncomingViewingKey, Scope, SpendAuthorizingKey, SpendValidatingKey,
        SpendingKey,
    },
    note::{AssetBase, AssetId, ExtractedNoteCommitment, Note, Nullifier, RandomSeed, Rho},
    primitives::redpallas::{self, SpendAuth},
    primitives::{CompactAction, OrchardDomain, OrchardPrimitives},
    tree::{MerkleHashOrchard, MerklePath},
    value::NoteValue,
};
use pasta_curves::pallas;
use zcash_note_encryption::{
    EphemeralKeyBytes, note_bytes::NoteBytes, try_compact_note_decryption,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ZsaError {
    InvalidNullifierKey,
    InvalidRho,
    InvalidNoteRandomness,
    InvalidNoteCommitment,
    InvalidClaimDomain,
    InvalidScalarConversion,
    InvalidAssetId,
    ZeroThreshold,
    UnsupportedSplitNote,
    InvalidSpendAuthKey,
    InvalidSpendAuthRandomizer,
    InvalidSpendAuthSignature,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NoteProofError {
    InvalidSpendingKey,
    InvalidAssetId,
    InvalidRho,
    InvalidRandomSeed,
    InvalidMerklePath,
    InvalidExclusionWitness,
    InvalidScope,
    InvalidNote,
    InvalidAlternateNullifier,
    InvalidRandomizer,
    InvalidCompactActions,
    CommitmentRootMismatch,
    ExclusionRootMismatch,
    NoEligibleNote,
    ClaimProof(ClaimProofError),
}

pub fn derive_alternate_nullifier(
    nk: &[u8; 32],
    standard_nullifier: &[u8; 32],
    domain: &[u8; 32],
) -> Result<[u8; 32], ZsaError> {
    let nk = parse_field(nk).ok_or(ZsaError::InvalidNullifierKey)?;
    let standard_nullifier =
        parse_field(standard_nullifier).ok_or(ZsaError::InvalidNullifierKey)?;
    let domain = parse_field(domain).ok_or(ZsaError::InvalidClaimDomain)?;
    Ok(Hash::<_, P128Pow5T3, ConstantLength<3>, 3, 2>::init()
        .hash([nk, domain, standard_nullifier])
        .to_repr())
}

fn parse_field(bytes: &[u8; 32]) -> Option<pallas::Base> {
    Option::from(pallas::Base::from_repr(*bytes))
}

fn parse_asset_id(asset_id: &[u8]) -> Result<(IssueValidatingKey<ZSASchnorr>, [u8; 32]), ZsaError> {
    if asset_id.len() != 66 || asset_id[0] != 0 {
        return Err(ZsaError::InvalidAssetId);
    }
    let issuer = IssueValidatingKey::<ZSASchnorr>::decode(&asset_id[1..34])
        .map_err(|_| ZsaError::InvalidAssetId)?;
    let asset_desc_hash: [u8; 32] = asset_id[34..]
        .try_into()
        .map_err(|_| ZsaError::InvalidAssetId)?;
    Ok((issuer, asset_desc_hash))
}

pub fn derive_asset_base(asset_id: &[u8]) -> Result<[u8; 32], ZsaError> {
    let (issuer, asset_desc_hash) = parse_asset_id(asset_id)?;
    let id = AssetId::new_v0(&issuer, &asset_desc_hash);
    Ok(AssetBase::custom(&id).to_bytes())
}

pub fn derive_note_alternate_nullifier(
    note: &Note,
    fvk: &FullViewingKey,
    domain: &[u8; 32],
) -> Result<[u8; 32], ZsaError> {
    let nk = fvk.nk().inner().to_repr();
    let standard_nullifier = note.nullifier(fvk).to_bytes();
    derive_alternate_nullifier(&nk, &standard_nullifier, domain)
}

pub fn derive_randomized_spend_key(
    fvk: &FullViewingKey,
    randomizer: &pallas::Scalar,
) -> Result<[u8; 32], ZsaError> {
    if bool::from(randomizer.is_zero()) {
        return Err(ZsaError::InvalidSpendAuthRandomizer);
    }
    let ak = SpendValidatingKey::from(fvk.clone());
    let randomized_key = ak.randomize(randomizer);
    if randomized_key.is_identity() {
        return Err(ZsaError::InvalidSpendAuthKey);
    }
    Ok((&randomized_key).into())
}

pub fn verify_spend_authorization(
    randomized_spend_key: [u8; 32],
    message: &[u8],
    signature: [u8; 64],
) -> Result<(), ZsaError> {
    let key = redpallas::VerificationKey::<SpendAuth>::try_from(randomized_spend_key)
        .map_err(|_| ZsaError::InvalidSpendAuthKey)?;
    let signature = redpallas::Signature::<SpendAuth>::from(signature);
    key.verify(message, &signature)
        .map_err(|_| ZsaError::InvalidSpendAuthSignature)
}

pub fn create_spend_authorization(
    spending_key: &SpendingKey,
    randomizer: &pallas::Scalar,
    message: &[u8],
) -> Result<([u8; 32], [u8; 64]), ZsaError> {
    if bool::from(randomizer.is_zero()) {
        return Err(ZsaError::InvalidSpendAuthRandomizer);
    }
    let ask = SpendAuthorizingKey::from(spending_key);
    let randomized_signing_key = ask.randomize(randomizer);
    let randomized_spend_key: [u8; 32] =
        (&SpendValidatingKey::from(&ask).randomize(randomizer)).into();
    if randomized_spend_key == [0; 32] {
        return Err(ZsaError::InvalidSpendAuthKey);
    }
    let signature = randomized_signing_key.sign(rand::rngs::OsRng, message);
    let signature = (&signature).into();
    Ok((randomized_spend_key, signature))
}

pub fn prove_single_note_claim(
    spec: &ClaimSpec,
    spending_key_bytes: [u8; 32],
    value: u64,
    rho_bytes: [u8; 32],
    rseed_bytes: [u8; 32],
    diversifier_index: u32,
    scope_code: u8,
    merkle_position: u32,
    merkle_path_bytes: &[u8],
    exclusion_witness: ExclusionWitness,
) -> Result<Vec<u8>, NoteProofError> {
    let spending_key = Option::<SpendingKey>::from(SpendingKey::from_bytes(spending_key_bytes))
        .ok_or(NoteProofError::InvalidSpendingKey)?;
    let (issuer, asset_desc_hash) =
        parse_asset_id(&spec.asset_id).map_err(|_| NoteProofError::InvalidAssetId)?;
    let asset_id = AssetId::new_v0(&issuer, &asset_desc_hash);
    let rho = Option::<Rho>::from(Rho::from_bytes(&rho_bytes)).ok_or(NoteProofError::InvalidRho)?;
    let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes(rseed_bytes, &rho))
        .ok_or(NoteProofError::InvalidRandomSeed)?;
    let scope = match scope_code {
        0 => Scope::External,
        1 => Scope::Internal,
        _ => return Err(NoteProofError::InvalidScope),
    };
    if merkle_path_bytes.len() != 32 * 32 {
        return Err(NoteProofError::InvalidMerklePath);
    }
    let mut path_nodes = Vec::with_capacity(32);
    for chunk in merkle_path_bytes.chunks_exact(32) {
        let bytes: [u8; 32] = chunk
            .try_into()
            .map_err(|_| NoteProofError::InvalidMerklePath)?;
        let node = Option::<MerkleHashOrchard>::from(MerkleHashOrchard::from_bytes(&bytes))
            .ok_or(NoteProofError::InvalidMerklePath)?;
        path_nodes.push(node);
    }
    let path_nodes: [MerkleHashOrchard; 32] = path_nodes
        .try_into()
        .map_err(|_| NoteProofError::InvalidMerklePath)?;
    let merkle_path = MerklePath::from_parts(merkle_position, path_nodes);
    let fvk = FullViewingKey::from(&spending_key);
    let note = Option::<Note>::from(Note::from_parts(
        fvk.address_at(diversifier_index, scope),
        NoteValue::from_raw(value),
        AssetBase::custom(&asset_id),
        rho,
        rseed,
    ))
    .ok_or(NoteProofError::InvalidNote)?;
    prove_note_claim_with_note(
        spec,
        spending_key,
        note,
        scope,
        merkle_path,
        exclusion_witness,
    )
}

fn prove_note_claim_with_note(
    spec: &ClaimSpec,
    spending_key: SpendingKey,
    note: Note,
    scope: Scope,
    merkle_path: MerklePath,
    exclusion_witness: ExclusionWitness,
) -> Result<Vec<u8>, NoteProofError> {
    let fvk = FullViewingKey::from(&spending_key);
    verify_exclusion_witness(
        spec.exclusion_root,
        note.nullifier(&fvk).to_bytes(),
        &exclusion_witness,
    )
    .map_err(|_| NoteProofError::InvalidExclusionWitness)?;
    let domain = parse_field(
        &spec
            .claim_domain()
            .map_err(|error| NoteProofError::ClaimProof(ClaimProofError::InvalidClaim(error)))?,
    )
    .ok_or(NoteProofError::InvalidAlternateNullifier)?;
    let alternate_nullifier = derive_note_alternate_nullifier(&note, &fvk, &domain.to_repr())
        .map_err(|_| NoteProofError::InvalidAlternateNullifier)?;
    let mut randomizer = pallas::Scalar::random(rand::rngs::OsRng);
    while bool::from(randomizer.is_zero()) {
        randomizer = pallas::Scalar::random(rand::rngs::OsRng);
    }
    let randomized_spend_key = derive_randomized_spend_key(&fvk, &randomizer)
        .map_err(|_| NoteProofError::InvalidRandomizer)?;
    let message = spec
        .spend_authorization_message(alternate_nullifier)
        .map_err(|error| NoteProofError::ClaimProof(ClaimProofError::InvalidClaim(error)))?;
    let (_, spend_authorization) = create_spend_authorization(&spending_key, &randomizer, &message)
        .map_err(|_| NoteProofError::InvalidRandomizer)?;
    let circuit = NoteCommitmentCircuit::new(
        note,
        fvk,
        domain,
        parse_field(&spec.exclusion_root).ok_or(NoteProofError::InvalidExclusionWitness)?,
        spec.threshold,
        scope,
        randomizer,
        merkle_path,
        exclusion_witness,
    )
    .map_err(|_| NoteProofError::InvalidNote)?;
    ClaimProof::create(
        spec,
        &circuit,
        alternate_nullifier,
        randomized_spend_key,
        spend_authorization,
    )
    .and_then(|proof| proof.to_bytes())
    .map_err(NoteProofError::ClaimProof)
}

pub fn prove_scanned_single_note_claim(
    spec: &ClaimSpec,
    spending_key_bytes: [u8; 32],
    packed_actions: &[u8],
) -> Result<Vec<u8>, NoteProofError> {
    const ACTION_HEADER_BYTES: usize = 1 + 32 + 32 + 32 + 1;
    const ISSUANCE_NOTE_RECORD_BYTES: usize = 1 + 32 + 32 + 43 + 8 + 32 + 32;
    const VANILLA_COMPACT_CIPHERTEXT_BYTES: usize = 52;
    const ZSA_COMPACT_CIPHERTEXT_BYTES: usize =
        <OrchardZSA as OrchardPrimitives>::COMPACT_NOTE_SIZE;
    if packed_actions.is_empty() {
        return Err(NoteProofError::InvalidCompactActions);
    }
    let nullifiers = compact_action_nullifiers(packed_actions)?;
    let exclusion_tree = crate::ExclusionTree::from_nullifiers(nullifiers)
        .map_err(|_| NoteProofError::InvalidExclusionWitness)?;
    if exclusion_tree.root() != spec.exclusion_root {
        return Err(NoteProofError::ExclusionRootMismatch);
    }
    let spending_key = Option::<SpendingKey>::from(SpendingKey::from_bytes(spending_key_bytes))
        .ok_or(NoteProofError::InvalidSpendingKey)?;
    let (issuer, asset_desc_hash) =
        parse_asset_id(&spec.asset_id).map_err(|_| NoteProofError::InvalidAssetId)?;
    let asset_id = AssetId::new_v0(&issuer, &asset_desc_hash);
    let expected_asset_base = AssetBase::custom(&asset_id).to_bytes();
    let fvk = FullViewingKey::from(&spending_key);
    let mut frontier = Frontier::<MerkleHashOrchard, 32>::empty();
    let mut note_witness: Option<IncrementalWitness<MerkleHashOrchard, 32>> = None;
    let mut candidate: Option<(Note, Scope, crate::ExclusionWitness)> = None;
    let mut offset = 0;

    while offset < packed_actions.len() {
        let record_type = packed_actions[offset];
        if record_type == 3 {
            if packed_actions.len() - offset < ISSUANCE_NOTE_RECORD_BYTES {
                return Err(NoteProofError::InvalidCompactActions);
            }
            let record = &packed_actions[offset + 1..offset + ISSUANCE_NOTE_RECORD_BYTES];
            let cmx_bytes: [u8; 32] = record[..32]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let cmx = Option::<ExtractedNoteCommitment>::from(ExtractedNoteCommitment::from_bytes(
                &cmx_bytes,
            ))
            .ok_or(NoteProofError::InvalidCompactActions)?;
            let asset_base_bytes: [u8; 32] = record[32..64]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let asset_base = Option::<AssetBase>::from(AssetBase::from_bytes(&asset_base_bytes))
                .ok_or(NoteProofError::InvalidCompactActions)?;
            let recipient_bytes: [u8; 43] = record[64..107]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let recipient =
                Option::<Address>::from(Address::from_raw_address_bytes(&recipient_bytes))
                    .ok_or(NoteProofError::InvalidCompactActions)?;
            let value_bytes: [u8; 8] = record[107..115]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let rho_bytes: [u8; 32] = record[115..147]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let rho = Option::<Rho>::from(Rho::from_bytes(&rho_bytes))
                .ok_or(NoteProofError::InvalidCompactActions)?;
            let rseed_bytes: [u8; 32] = record[147..179]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let rseed = Option::<RandomSeed>::from(RandomSeed::from_bytes(rseed_bytes, &rho))
                .ok_or(NoteProofError::InvalidCompactActions)?;
            let note = Option::<Note>::from(Note::from_parts(
                recipient,
                NoteValue::from_bytes(value_bytes),
                asset_base,
                rho,
                rseed,
            ))
            .ok_or(NoteProofError::InvalidCompactActions)?;
            if ExtractedNoteCommitment::from(note.commitment()) != cmx {
                return Err(NoteProofError::InvalidCompactActions);
            }
            let leaf = MerkleHashOrchard::from_cmx(&cmx);
            if !frontier.append(leaf) {
                return Err(NoteProofError::InvalidCompactActions);
            }
            if let Some(witness) = note_witness.as_mut() {
                witness
                    .append(leaf)
                    .map_err(|_| NoteProofError::InvalidCompactActions)?;
            }
            if candidate.is_none()
                && note.asset().to_bytes() == expected_asset_base
                && note.value().inner() >= spec.threshold
                && note.psi_nf() == note.rseed().psi(&note.rho())
            {
                if let Some(scope) = fvk.scope_for_address(&recipient) {
                    if let Ok(exclusion_witness) =
                        exclusion_tree.witness(note.nullifier(&fvk).to_bytes())
                    {
                        let tree = CommitmentTree::from_frontier(&frontier);
                        note_witness = IncrementalWitness::from_tree(tree);
                        candidate = Some((note, scope, exclusion_witness));
                    }
                }
            }
            offset += ISSUANCE_NOTE_RECORD_BYTES;
            continue;
        }
        if record_type == 2 {
            if packed_actions.len() - offset < 33 {
                return Err(NoteProofError::InvalidCompactActions);
            }
            let cmx_bytes: [u8; 32] = packed_actions[offset + 1..offset + 33]
                .try_into()
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
            let cmx = Option::<ExtractedNoteCommitment>::from(ExtractedNoteCommitment::from_bytes(
                &cmx_bytes,
            ))
            .ok_or(NoteProofError::InvalidCompactActions)?;
            let leaf = MerkleHashOrchard::from_cmx(&cmx);
            if !frontier.append(leaf) {
                return Err(NoteProofError::InvalidCompactActions);
            }
            if let Some(witness) = note_witness.as_mut() {
                witness
                    .append(leaf)
                    .map_err(|_| NoteProofError::InvalidCompactActions)?;
            }
            offset += 33;
            continue;
        }
        if record_type != 1 {
            return Err(NoteProofError::InvalidCompactActions);
        }
        if packed_actions.len() - offset < ACTION_HEADER_BYTES {
            return Err(NoteProofError::InvalidCompactActions);
        }
        let action_bytes = &packed_actions[offset + 1..];
        let ciphertext_length = usize::from(action_bytes[96]);
        if !matches!(
            ciphertext_length,
            VANILLA_COMPACT_CIPHERTEXT_BYTES | ZSA_COMPACT_CIPHERTEXT_BYTES
        ) || action_bytes.len() < ACTION_HEADER_BYTES - 1 + ciphertext_length
        {
            return Err(NoteProofError::InvalidCompactActions);
        }
        let nullifier_bytes: [u8; 32] = action_bytes[..32]
            .try_into()
            .map_err(|_| NoteProofError::InvalidCompactActions)?;
        let nullifier = Option::<Nullifier>::from(Nullifier::from_bytes(&nullifier_bytes))
            .ok_or(NoteProofError::InvalidCompactActions)?;
        let cmx_bytes: [u8; 32] = action_bytes[32..64]
            .try_into()
            .map_err(|_| NoteProofError::InvalidCompactActions)?;
        let cmx = Option::<ExtractedNoteCommitment>::from(ExtractedNoteCommitment::from_bytes(
            &cmx_bytes,
        ))
        .ok_or(NoteProofError::InvalidCompactActions)?;
        let ephemeral_key: [u8; 32] = action_bytes[64..96]
            .try_into()
            .map_err(|_| NoteProofError::InvalidCompactActions)?;
        let leaf = MerkleHashOrchard::from_cmx(&cmx);
        if !frontier.append(leaf) {
            return Err(NoteProofError::InvalidCompactActions);
        }
        if let Some(witness) = note_witness.as_mut() {
            witness
                .append(leaf)
                .map_err(|_| NoteProofError::InvalidCompactActions)?;
        } else if ciphertext_length == ZSA_COMPACT_CIPHERTEXT_BYTES {
            let ciphertext =
                <OrchardZSA as OrchardPrimitives>::CompactNoteCiphertextBytes::from_slice(
                    &action_bytes
                        [ACTION_HEADER_BYTES - 1..ACTION_HEADER_BYTES - 1 + ciphertext_length],
                )
                .ok_or(NoteProofError::InvalidCompactActions)?;
            let action = CompactAction::<OrchardZSA>::from_parts(
                nullifier,
                cmx,
                EphemeralKeyBytes(ephemeral_key),
                ciphertext,
            );
            let domain = OrchardDomain::<OrchardZSA>::for_compact_action(&action);
            for scope in [Scope::External, Scope::Internal] {
                if let Some((note, _address)) = try_compact_note_decryption(
                    &domain,
                    &PreparedIncomingViewingKey::new(&fvk.to_ivk(scope)),
                    &action,
                ) {
                    if note.asset().to_bytes() == expected_asset_base
                        && note.value().inner() >= spec.threshold
                        && note.psi_nf() == note.rseed().psi(&note.rho())
                    {
                        let Ok(exclusion_witness) =
                            exclusion_tree.witness(note.nullifier(&fvk).to_bytes())
                        else {
                            continue;
                        };
                        let tree = CommitmentTree::from_frontier(&frontier);
                        note_witness = IncrementalWitness::from_tree(tree);
                        candidate = Some((note, scope, exclusion_witness));
                        break;
                    }
                }
            }
        }
        offset += ACTION_HEADER_BYTES + ciphertext_length;
    }

    if frontier.root().to_bytes() != spec.commitment_root {
        return Err(NoteProofError::CommitmentRootMismatch);
    }
    let (note, scope, exclusion_witness) = candidate.ok_or(NoteProofError::NoEligibleNote)?;
    let note_witness = note_witness.ok_or(NoteProofError::NoEligibleNote)?;
    let merkle_path = note_witness
        .path()
        .ok_or(NoteProofError::InvalidMerklePath)?
        .into();
    prove_note_claim_with_note(
        spec,
        spending_key,
        note,
        scope,
        merkle_path,
        exclusion_witness,
    )
}

fn compact_action_nullifiers(packed_actions: &[u8]) -> Result<Vec<[u8; 32]>, NoteProofError> {
    const ACTION_HEADER_BYTES: usize = 1 + 32 + 32 + 32 + 1;
    const VANILLA_COMPACT_CIPHERTEXT_BYTES: usize = 52;
    const ZSA_COMPACT_CIPHERTEXT_BYTES: usize =
        <OrchardZSA as OrchardPrimitives>::COMPACT_NOTE_SIZE;
    const ISSUANCE_NOTE_RECORD_BYTES: usize = 1 + 32 + 32 + 43 + 8 + 32 + 32;
    let mut nullifiers = Vec::with_capacity(packed_actions.len() / ACTION_HEADER_BYTES);
    let mut offset = 0;
    while offset < packed_actions.len() {
        let record_type = packed_actions[offset];
        if record_type == 2 {
            if packed_actions.len() - offset < 33 {
                return Err(NoteProofError::InvalidCompactActions);
            }
            offset += 33;
            continue;
        }
        if record_type == 3 {
            if packed_actions.len() - offset < ISSUANCE_NOTE_RECORD_BYTES {
                return Err(NoteProofError::InvalidCompactActions);
            }
            offset += ISSUANCE_NOTE_RECORD_BYTES;
            continue;
        }
        if record_type != 1 {
            return Err(NoteProofError::InvalidCompactActions);
        }
        if packed_actions.len() - offset < ACTION_HEADER_BYTES {
            return Err(NoteProofError::InvalidCompactActions);
        }
        let action_bytes = &packed_actions[offset + 1..];
        let ciphertext_length = usize::from(action_bytes[96]);
        if !matches!(
            ciphertext_length,
            VANILLA_COMPACT_CIPHERTEXT_BYTES | ZSA_COMPACT_CIPHERTEXT_BYTES
        ) || action_bytes.len() < ACTION_HEADER_BYTES - 1 + ciphertext_length
        {
            return Err(NoteProofError::InvalidCompactActions);
        }
        let nullifier_bytes: [u8; 32] = action_bytes[..32]
            .try_into()
            .map_err(|_| NoteProofError::InvalidCompactActions)?;
        Option::<Nullifier>::from(Nullifier::from_bytes(&nullifier_bytes))
            .ok_or(NoteProofError::InvalidCompactActions)?;
        nullifiers.push(nullifier_bytes);
        offset += ACTION_HEADER_BYTES + ciphertext_length;
    }
    Ok(nullifiers)
}

#[derive(Clone, Debug)]
pub struct NoteCommitmentCircuit {
    note: Value<Note>,
    fvk: Value<FullViewingKey>,
    domain: Value<pallas::Base>,
    exclusion_root: Value<pallas::Base>,
    exclusion_low: Value<pallas::Base>,
    exclusion_width: Value<pallas::Base>,
    exclusion_position: Value<u32>,
    exclusion_path: Value<[pallas::Base; EXCLUSION_TREE_DEPTH]>,
    threshold: Value<u64>,
    rivk: Value<pallas::Scalar>,
    spend_auth_randomizer: Value<pallas::Scalar>,
    rho: Value<pallas::Base>,
    slack: Value<pallas::Base>,
    position: Value<u32>,
    merkle_path: Value<[pallas::Base; 32]>,
}

#[derive(Clone, Debug)]
pub struct ExclusionGate {
    interval_selector: Selector,
    upper_selector: Selector,
    nonzero_selector: Selector,
    advices: [Column<Advice>; 3],
}

impl ExclusionGate {
    fn configure(meta: &mut ConstraintSystem<pallas::Base>, advices: [Column<Advice>; 3]) -> Self {
        let interval_selector = meta.selector();
        meta.create_gate("exclusion interval offset", |meta| {
            let q = meta.query_selector(interval_selector);
            let nullifier = meta.query_advice(advices[0], Rotation::cur());
            let low = meta.query_advice(advices[1], Rotation::cur());
            let offset = meta.query_advice(advices[2], Rotation::cur());
            Constraints::with_selector(q, [("offset = nullifier - low", offset - nullifier + low)])
        });

        let upper_selector = meta.selector();
        let maximum = pallas::Base::from(2).pow([250, 0, 0, 0]) - pallas::Base::one();
        meta.create_gate("exclusion interval upper bound", |meta| {
            let q = meta.query_selector(upper_selector);
            let width = meta.query_advice(advices[0], Rotation::cur());
            let offset = meta.query_advice(advices[1], Rotation::cur());
            let upper = meta.query_advice(advices[2], Rotation::cur());
            Constraints::with_selector(
                q,
                [(
                    "upper = 2^250 - 1 - width + offset",
                    upper - Expression::Constant(maximum) + width - offset,
                )],
            )
        });

        let nonzero_selector = meta.selector();
        meta.create_gate("exclusion gap low is nonzero", |meta| {
            let q = meta.query_selector(nonzero_selector);
            let low = meta.query_advice(advices[0], Rotation::cur());
            let inverse = meta.query_advice(advices[1], Rotation::cur());
            Constraints::with_selector(
                q,
                [(
                    "low * inverse = 1",
                    low * inverse - Expression::Constant(pallas::Base::one()),
                )],
            )
        });

        Self {
            interval_selector,
            upper_selector,
            nonzero_selector,
            advices,
        }
    }

    fn assign(
        &self,
        layouter: &mut impl Layouter<pallas::Base>,
        nullifier: &halo2_proofs::circuit::AssignedCell<pallas::Base, pallas::Base>,
        low: &halo2_proofs::circuit::AssignedCell<pallas::Base, pallas::Base>,
        width: &halo2_proofs::circuit::AssignedCell<pallas::Base, pallas::Base>,
    ) -> Result<
        (
            halo2_proofs::circuit::AssignedCell<pallas::Base, pallas::Base>,
            halo2_proofs::circuit::AssignedCell<pallas::Base, pallas::Base>,
        ),
        Error,
    > {
        layouter.assign_region(
            || "exclusion interval bounds",
            |mut region| {
                self.interval_selector.enable(&mut region, 0)?;
                let nullifier = nullifier.copy_advice(
                    || "standard nullifier",
                    &mut region,
                    self.advices[0],
                    0,
                )?;
                let low = low.copy_advice(|| "gap low", &mut region, self.advices[1], 0)?;
                let offset = region.assign_advice(
                    || "nullifier offset",
                    self.advices[2],
                    0,
                    || {
                        nullifier
                            .value()
                            .copied()
                            .zip(low.value().copied())
                            .map(|(n, l)| n - l)
                    },
                )?;

                self.upper_selector.enable(&mut region, 1)?;
                let width = width.copy_advice(|| "gap width", &mut region, self.advices[0], 1)?;
                let offset =
                    offset.copy_advice(|| "nullifier offset", &mut region, self.advices[1], 1)?;
                let maximum = pallas::Base::from(2).pow([250, 0, 0, 0]) - pallas::Base::one();
                let upper = region.assign_advice(
                    || "upper interval bound",
                    self.advices[2],
                    1,
                    || {
                        width
                            .value()
                            .copied()
                            .zip(offset.value().copied())
                            .map(|(w, x)| maximum - w + x)
                    },
                )?;
                self.nonzero_selector.enable(&mut region, 2)?;
                low.copy_advice(|| "nonzero gap low", &mut region, self.advices[0], 2)?;
                region.assign_advice(
                    || "gap low inverse",
                    self.advices[1],
                    2,
                    || {
                        low.value()
                            .copied()
                            .map(|value| value.invert().unwrap_or_else(pallas::Base::zero))
                    },
                )?;
                Ok((offset, upper))
            },
        )
    }
}

impl NoteCommitmentCircuit {
    pub fn blank() -> Self {
        Self {
            note: Value::unknown(),
            fvk: Value::unknown(),
            domain: Value::unknown(),
            exclusion_root: Value::unknown(),
            exclusion_low: Value::unknown(),
            exclusion_width: Value::unknown(),
            exclusion_position: Value::unknown(),
            exclusion_path: Value::unknown(),
            threshold: Value::unknown(),
            rivk: Value::unknown(),
            spend_auth_randomizer: Value::unknown(),
            rho: Value::unknown(),
            slack: Value::unknown(),
            position: Value::unknown(),
            merkle_path: Value::unknown(),
        }
    }

    pub fn new(
        note: Note,
        fvk: FullViewingKey,
        domain: pallas::Base,
        exclusion_root: pallas::Base,
        threshold: u64,
        scope: Scope,
        spend_auth_randomizer: pallas::Scalar,
        merkle_path: orchard::tree::MerklePath,
        exclusion_witness: ExclusionWitness,
    ) -> Result<Self, ZsaError> {
        if threshold == 0 {
            return Err(ZsaError::ZeroThreshold);
        }
        if note.psi_nf() != note.rseed().psi(&note.rho()) {
            return Err(ZsaError::UnsupportedSplitNote);
        }
        if bool::from(spend_auth_randomizer.is_zero()) {
            return Err(ZsaError::InvalidSpendAuthRandomizer);
        }
        let rho = note.rho().into_inner();
        verify_exclusion_witness(
            exclusion_root.to_repr(),
            note.nullifier(&fvk).to_bytes(),
            &exclusion_witness,
        )
        .map_err(|_| ZsaError::InvalidNoteCommitment)?;
        let exclusion_low =
            parse_field(&exclusion_witness.interval.low).ok_or(ZsaError::InvalidNoteCommitment)?;
        let exclusion_width = parse_field(&exclusion_witness.interval.width)
            .ok_or(ZsaError::InvalidNoteCommitment)?;
        let exclusion_path = exclusion_witness
            .auth_path
            .map(|node| parse_field(&node).ok_or(ZsaError::InvalidNoteCommitment))
            .into_iter()
            .collect::<Result<Vec<_>, _>>()?
            .try_into()
            .map_err(|_| ZsaError::InvalidNoteCommitment)?;
        let slack = pallas::Base::from(note.value().inner().saturating_sub(threshold));
        let rivk = fvk.rivk(scope).inner();
        let position = merkle_path.position();
        let merkle_path = merkle_path.auth_path().map(|node| node.inner());
        Ok(Self {
            note: Value::known(note),
            fvk: Value::known(fvk),
            domain: Value::known(domain),
            exclusion_root: Value::known(exclusion_root),
            exclusion_low: Value::known(exclusion_low),
            exclusion_width: Value::known(exclusion_width),
            exclusion_position: Value::known(exclusion_witness.position),
            exclusion_path: Value::known(exclusion_path),
            threshold: Value::known(threshold),
            rivk: Value::known(rivk),
            spend_auth_randomizer: Value::known(spend_auth_randomizer),
            rho: Value::known(rho),
            slack: Value::known(slack),
            position: Value::known(position),
            merkle_path: Value::known(merkle_path),
        })
    }

    #[cfg(feature = "test-utils")]
    #[doc(hidden)]
    pub fn with_private_witnesses(
        note: Note,
        fvk: FullViewingKey,
        domain: pallas::Base,
        exclusion_root: pallas::Base,
        threshold: u64,
        scope: Scope,
        spend_auth_randomizer: pallas::Scalar,
        rho: pallas::Base,
        slack: pallas::Base,
        merkle_path: orchard::tree::MerklePath,
        exclusion_witness: ExclusionWitness,
    ) -> Result<Self, ZsaError> {
        let mut circuit = Self::new(
            note,
            fvk,
            domain,
            exclusion_root,
            threshold,
            scope,
            spend_auth_randomizer,
            merkle_path,
            exclusion_witness,
        )?;
        circuit.rho = Value::known(rho);
        circuit.slack = Value::known(slack);
        Ok(circuit)
    }
}

impl Circuit<pallas::Base> for NoteCommitmentCircuit {
    type Config = (
        [Column<Advice>; 10],
        NoteCommitConfig<PallasLookupRangeCheck4_5BConfig>,
        CommitIvkConfig,
        EccConfig<OrchardFixedBases, PallasLookupRangeCheck4_5BConfig>,
        CondSwapConfig,
        Pow5Config<pallas::Base, 3, 2>,
        AddConfig,
        PallasLookupRangeCheck4_5BConfig,
        SinsemillaConfig<
            OrchardHashDomains,
            OrchardCommitDomains,
            OrchardFixedBases,
            PallasLookupRangeCheck4_5BConfig,
        >,
        MerkleConfig<
            OrchardHashDomains,
            OrchardCommitDomains,
            OrchardFixedBases,
            PallasLookupRangeCheck4_5BConfig,
        >,
        MerkleConfig<
            OrchardHashDomains,
            OrchardCommitDomains,
            OrchardFixedBases,
            PallasLookupRangeCheck4_5BConfig,
        >,
        Column<Instance>,
        ExclusionGate,
    );
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self {
            note: Value::unknown(),
            fvk: Value::unknown(),
            domain: Value::unknown(),
            exclusion_root: Value::unknown(),
            exclusion_low: Value::unknown(),
            exclusion_width: Value::unknown(),
            exclusion_position: Value::unknown(),
            exclusion_path: Value::unknown(),
            threshold: Value::unknown(),
            rivk: Value::unknown(),
            spend_auth_randomizer: Value::unknown(),
            rho: Value::unknown(),
            slack: Value::unknown(),
            position: Value::unknown(),
            merkle_path: Value::unknown(),
        }
    }

    fn configure(meta: &mut ConstraintSystem<pallas::Base>) -> Self::Config {
        let advices = [
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
            meta.advice_column(),
        ];
        let constants = meta.fixed_column();
        meta.enable_constant(constants);
        let fixed = [
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
            meta.fixed_column(),
        ];
        meta.enable_constant(fixed[0]);
        for advice in advices {
            meta.enable_equality(advice);
        }
        let table_idx = meta.lookup_table_column();
        let table_range_check_tag = meta.lookup_table_column();
        let lookup = (
            table_idx,
            meta.lookup_table_column(),
            meta.lookup_table_column(),
        );
        let lagrange_coeffs = [
            fixed[0], fixed[1], fixed[2], fixed[3], fixed[4], fixed[5], fixed[6], fixed[7],
        ];
        let poseidon_config = Pow5Chip::<pallas::Base, 3, 2>::configure::<P128Pow5T3>(
            meta,
            advices[6..9].try_into().unwrap(),
            advices[5],
            lagrange_coeffs[2..5].try_into().unwrap(),
            lagrange_coeffs[5..8].try_into().unwrap(),
        );
        let add_config = AddChip::configure(meta, advices[0], advices[1], advices[2]);
        let range_check = PallasLookupRangeCheck4_5BConfig::configure_with_tag(
            meta,
            advices[9],
            table_idx,
            table_range_check_tag,
        );
        let sinsemilla_config = SinsemillaChip::<
            OrchardHashDomains,
            OrchardCommitDomains,
            OrchardFixedBases,
            PallasLookupRangeCheck4_5BConfig,
        >::configure(
            meta,
            advices[..5].try_into().unwrap(),
            advices[2],
            lagrange_coeffs[0],
            lookup,
            range_check,
            true,
        );
        let merkle_config_1 = MerkleChip::configure(meta, sinsemilla_config.clone());
        let sinsemilla_config_2 = SinsemillaChip::<
            OrchardHashDomains,
            OrchardCommitDomains,
            OrchardFixedBases,
            PallasLookupRangeCheck4_5BConfig,
        >::configure(
            meta,
            advices[5..].try_into().unwrap(),
            advices[7],
            lagrange_coeffs[1],
            lookup,
            range_check,
            true,
        );
        let merkle_config_2 = MerkleChip::configure(meta, sinsemilla_config_2.clone());
        let note_commit_config =
            NoteCommitChip::configure(meta, advices, sinsemilla_config.clone(), true);
        let commit_ivk_config = CommitIvkChip::configure(meta, advices);
        let ecc_config = EccChip::<OrchardFixedBases, PallasLookupRangeCheck4_5BConfig>::configure(
            meta,
            advices,
            lagrange_coeffs,
            range_check,
        );
        let cond_swap_config = CondSwapChip::configure(meta, advices[..5].try_into().unwrap());
        let instance = meta.instance_column();
        meta.enable_equality(instance);
        let exclusion_gate = ExclusionGate::configure(meta, advices[..3].try_into().unwrap());
        (
            advices,
            note_commit_config,
            commit_ivk_config,
            ecc_config,
            cond_swap_config,
            poseidon_config,
            add_config,
            range_check,
            sinsemilla_config,
            merkle_config_1,
            merkle_config_2,
            instance,
            exclusion_gate,
        )
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<pallas::Base>,
    ) -> Result<(), Error> {
        let (
            advices,
            note_commit_config,
            commit_ivk_config,
            ecc_config,
            cond_swap_config,
            poseidon_config,
            add_config,
            range_check,
            sinsemilla_config,
            merkle_config_1,
            merkle_config_2,
            instance,
            exclusion_gate,
        ) = config;
        SinsemillaChip::<
            OrchardHashDomains,
            OrchardCommitDomains,
            OrchardFixedBases,
            PallasLookupRangeCheck4_5BConfig,
        >::load(sinsemilla_config.clone(), &mut layouter)?;
        let sinsemilla_chip = SinsemillaChip::construct(sinsemilla_config);
        let ecc_chip = EccChip::construct(ecc_config, CircuitVersion::AnchoredBase);
        let note_commit_chip = NoteCommitChip::construct(note_commit_config);
        let commit_ivk_chip = CommitIvkChip::construct(commit_ivk_config);
        let cond_swap_chip = CondSwapChip::construct(cond_swap_config);
        let add_chip = AddChip::construct(add_config);
        let merkle_chips = [
            MerkleChip::construct(merkle_config_1),
            MerkleChip::construct(merkle_config_2),
        ];
        let merkle_path = CircuitMerklePath::construct(
            merkle_chips,
            OrchardHashDomains::MerkleCrh,
            self.position,
            self.merkle_path,
        );

        let g_d = NonIdentityPoint::new(
            ecc_chip.clone(),
            layouter.namespace(|| "witness g_d"),
            self.note
                .clone()
                .map(|note| note.recipient().g_d().to_affine()),
        )?;
        let pk_d = NonIdentityPoint::new(
            ecc_chip.clone(),
            layouter.namespace(|| "witness pk_d"),
            self.note
                .clone()
                .map(|note| note.recipient().pk_d().inner().to_affine()),
        )?;
        let value = assign_free_advice(
            layouter.namespace(|| "witness value"),
            advices[0],
            self.note.clone().map(|note| note.value()),
        )?;
        let rho = assign_free_advice(layouter.namespace(|| "witness rho"), advices[0], self.rho)?;
        let psi = assign_free_advice(
            layouter.namespace(|| "witness psi"),
            advices[0],
            self.note.clone().map(|note| note.rseed().psi(&note.rho())),
        )?;
        let rcm = ScalarFixed::new(
            ecc_chip.clone(),
            layouter.namespace(|| "witness rcm"),
            self.note
                .clone()
                .map(|note| note.rseed().rcm(&note.rho()).inner()),
        )?;
        let asset = NonIdentityPoint::new(
            ecc_chip.clone(),
            layouter.namespace(|| "witness asset"),
            self.note
                .clone()
                .map(|note| note.asset().cv_base().to_affine()),
        )?;
        let is_zatoshi_asset = assign_is_zatoshi_asset(
            layouter.namespace(|| "witness is_zatoshi_asset"),
            advices[0],
            self.note.clone().map(|note| note.asset()),
        )?;
        let commitment = note_commit(
            layouter.namespace(|| "compute ZSA note commitment"),
            sinsemilla_chip.clone(),
            ecc_chip.clone(),
            note_commit_chip,
            g_d.inner(),
            pk_d.inner(),
            value.clone(),
            rho.clone(),
            psi.clone(),
            rcm,
            Some(ZsaNoteCommitParams {
                cond_swap_chip: cond_swap_chip.clone(),
                asset: asset.inner().clone(),
                is_zatoshi_asset,
            }),
        )?;
        let ak_point = NonIdentityPoint::new(
            ecc_chip.clone(),
            layouter.namespace(|| "witness spend validating key"),
            self.fvk.clone().map(|fvk| {
                let ak = SpendValidatingKey::from(fvk);
                pallas::Point::from(&ak).to_affine()
            }),
        )?;
        let alpha = ScalarFixed::new(
            ecc_chip.clone(),
            layouter.namespace(|| "spend authorization randomizer"),
            self.spend_auth_randomizer,
        )?;
        let spend_auth_g =
            FixedPoint::from_inner(ecc_chip.clone(), OrchardFixedBasesFull::SpendAuthG);
        let (alpha_commitment, _) = spend_auth_g.mul(
            layouter.namespace(|| "randomized spend authorization key"),
            alpha,
        )?;
        let randomized_spend_key =
            alpha_commitment.add(layouter.namespace(|| "randomized spend key"), &ak_point)?;
        layouter.constrain_instance(randomized_spend_key.inner().x().cell(), instance, 7)?;
        layouter.constrain_instance(randomized_spend_key.inner().y().cell(), instance, 8)?;
        let nk = assign_free_advice(
            layouter.namespace(|| "witness nullifier key"),
            advices[0],
            self.fvk.clone().map(|fvk| fvk.nk().inner()),
        )?;
        let rivk = ScalarFixed::new(
            ecc_chip.clone(),
            layouter.namespace(|| "witness incoming viewing key randomness"),
            self.rivk,
        )?;
        let ivk = commit_ivk(
            sinsemilla_chip.clone(),
            ecc_chip.clone(),
            commit_ivk_chip,
            layouter.namespace(|| "bind full viewing key to note recipient"),
            ak_point.extract_p().inner().clone(),
            nk.clone(),
            rivk,
        )?;
        let ivk = ScalarVar::from_base(
            ecc_chip.clone(),
            layouter.namespace(|| "incoming viewing key scalar"),
            ivk.inner(),
        )?;
        let (derived_pk_d, _) = g_d.mul(
            layouter.namespace(|| "derive note recipient from incoming viewing key"),
            ivk,
        )?;
        derived_pk_d
            .constrain_equal(layouter.namespace(|| "note recipient key equality"), &pk_d)?;
        let phi = assign_free_advice(
            layouter.namespace(|| "witness nullifier randomness"),
            advices[0],
            self.note.clone().map(|note| note.psi_nf()),
        )?;
        layouter.assign_region(
            || "bind nullifier randomness to note commitment",
            |mut region| {
                let psi =
                    psi.copy_advice(|| "note commitment randomness", &mut region, advices[0], 0)?;
                let phi = phi.copy_advice(|| "nullifier randomness", &mut region, advices[1], 0)?;
                region.constrain_equal(psi.cell(), phi.cell())
            },
        )?;
        let domain = assign_free_advice(
            layouter.namespace(|| "public claim domain"),
            advices[0],
            self.domain,
        )?;
        let exclusion_root = assign_free_advice(
            layouter.namespace(|| "public snapshot exclusion root"),
            advices[0],
            self.exclusion_root,
        )?;
        let exclusion_low = assign_free_advice(
            layouter.namespace(|| "private exclusion gap low"),
            advices[0],
            self.exclusion_low,
        )?;
        let exclusion_width = assign_free_advice(
            layouter.namespace(|| "private exclusion gap width"),
            advices[0],
            self.exclusion_width,
        )?;
        let threshold = assign_free_advice(
            layouter.namespace(|| "public balance threshold"),
            advices[0],
            self.threshold.map(pallas::Base::from),
        )?;
        let slack = assign_free_advice(
            layouter.namespace(|| "private balance above threshold"),
            advices[0],
            self.slack,
        )?;
        range_check.copy_check(
            layouter.namespace(|| "range check balance above threshold"),
            slack.clone(),
            13,
            true,
        )?;
        let threshold_sum = add_chip.add(
            layouter.namespace(|| "threshold plus private balance remainder"),
            &threshold,
            &slack,
        )?;
        layouter.assign_region(
            || "bind threshold sum to note value",
            |mut region| region.constrain_equal(threshold_sum.cell(), value.cell()),
        )?;
        let nf_prf = PoseidonHash::<pallas::Base, _, P128Pow5T3, ConstantLength<2>, 3, 2>::init(
            Pow5Chip::construct(poseidon_config.clone()),
            layouter.namespace(|| "standard nullifier PRF init"),
        )?
        .hash(
            layouter.namespace(|| "standard nullifier PRF"),
            [nk.clone(), rho],
        )?;
        let nf_scalar = add_chip.add(
            layouter.namespace(|| "standard nullifier scalar"),
            &nf_prf,
            &phi,
        )?;
        let nullifier_k = FixedPointBaseField::from_inner(ecc_chip.clone(), NullifierK.into());
        let nf_product = nullifier_k.mul(
            layouter.namespace(|| "standard nullifier fixed-base multiplication"),
            nf_scalar,
        )?;
        let standard_nullifier = commitment
            .add(
                layouter.namespace(|| "standard nullifier commitment addition"),
                &nf_product,
            )?
            .extract_p();
        let alternate_nullifier =
            PoseidonHash::<pallas::Base, _, P128Pow5T3, ConstantLength<3>, 3, 2>::init(
                Pow5Chip::construct(poseidon_config.clone()),
                layouter.namespace(|| "alternate nullifier init"),
            )?
            .hash(
                layouter.namespace(|| "alternate nullifier"),
                [nk, domain.clone(), standard_nullifier.inner().clone()],
            )?;

        let gap_hash = PoseidonHash::<pallas::Base, _, P128Pow5T3, ConstantLength<2>, 3, 2>::init(
            Pow5Chip::construct(poseidon_config.clone()),
            layouter.namespace(|| "exclusion gap commitment init"),
        )?
        .hash(
            layouter.namespace(|| "exclusion gap commitment"),
            [exclusion_low.clone(), exclusion_width.clone()],
        )?;
        let mut exclusion_node = gap_hash;
        for level in 0..EXCLUSION_TREE_DEPTH {
            let sibling = self.exclusion_path.map(|path| path[level]);
            let swap = self
                .exclusion_position
                .map(|position| ((position >> level) & 1) != 0);
            let (left, right) = cond_swap_chip.swap(
                layouter.namespace(|| format!("exclusion path order {level}")),
                (exclusion_node, sibling),
                swap,
            )?;
            exclusion_node =
                PoseidonHash::<pallas::Base, _, P128Pow5T3, ConstantLength<2>, 3, 2>::init(
                    Pow5Chip::construct(poseidon_config.clone()),
                    layouter.namespace(|| format!("exclusion node {level} init")),
                )?
                .hash(
                    layouter.namespace(|| format!("exclusion node {level}")),
                    [left, right],
                )?;
        }
        let (offset, upper) = exclusion_gate.assign(
            &mut layouter,
            standard_nullifier.inner(),
            &exclusion_low,
            &exclusion_width,
        )?;
        for (label, value) in [
            ("exclusion offset range", offset),
            ("exclusion gap width range", exclusion_width),
            ("exclusion upper bound range", upper),
        ] {
            range_check.copy_check(layouter.namespace(|| label), value, 25, true)?;
        }
        let root = merkle_path.calculate_root(
            layouter.namespace(|| "snapshot commitment path"),
            commitment.extract_p().inner().clone(),
        )?;
        let asset_point = asset.inner();
        layouter.constrain_instance(alternate_nullifier.cell(), instance, 0)?;
        layouter.constrain_instance(domain.cell(), instance, 1)?;
        layouter.constrain_instance(threshold.cell(), instance, 2)?;
        layouter.constrain_instance(asset_point.x().cell(), instance, 3)?;
        layouter.constrain_instance(asset_point.y().cell(), instance, 4)?;
        layouter.constrain_instance(root.cell(), instance, 5)?;
        layouter.constrain_instance(exclusion_root.cell(), instance, 6)?;
        layouter.constrain_instance(exclusion_node.cell(), instance, 6)
    }
}
