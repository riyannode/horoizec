use ff::PrimeField;
use group::{Curve, Group, GroupEncoding};
use halo2_proofs::dev::MockProver;
use horoi_claim::{
    ClaimError, ClaimProof, ClaimProofError, ClaimSpec, ClaimVerifier, EXCLUSION_TREE_DEPTH,
    ExclusionError, ExclusionTree, NoteCommitmentCircuit, NoteProofError, ZsaError,
    create_spend_authorization, derive_alternate_nullifier, derive_asset_base,
    derive_note_alternate_nullifier, derive_randomized_spend_key, prove_scanned_single_note_claim,
    prove_single_note_claim, verify_exclusion_witness, verify_spend_authorization,
};
use incrementalmerkletree::frontier::Frontier;
use orchard::{
    flavor::OrchardZSA,
    issuance::auth::{IssueValidatingKey, ZSASchnorr},
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{AssetBase, AssetId, ExtractedNoteCommitment, Note, Nullifier, Rho},
    primitives::{CompactAction, OrchardDomain, OrchardPrimitives},
    tree::{MerkleHashOrchard, MerklePath},
    value::NoteValue,
};
use pasta_curves::{arithmetic::CurveAffine, pallas};
use rand::{RngCore, rngs::OsRng};
use std::time::Instant;
use zcash_note_encryption::{
    Domain, EphemeralKeyBytes, NoteEncryption, note_bytes::NoteBytes, try_compact_note_decryption,
};

fn asset_id(desc: [u8; 32]) -> Vec<u8> {
    let issuer = [
        0, 0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62, 0x95, 0xce, 0x87,
        0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16,
        0xf8, 0x17, 0x98,
    ];
    let ik = IssueValidatingKey::<ZSASchnorr>::decode(&issuer).unwrap();
    let mut asset_id = vec![0];
    asset_id.extend_from_slice(&ik.encode());
    asset_id.extend_from_slice(&desc);
    asset_id
}

fn claim() -> ClaimSpec {
    ClaimSpec {
        network_id: "zebra-regtest".to_owned(),
        asset_id: asset_id([7; 32]),
        threshold: 100,
        snapshot_height: 42,
        commitment_root: [8; 32],
        exclusion_root: [9; 32],
        expires_at: Some(1_900_000_000),
        creator_nonce: [10; 32],
    }
}

fn test_nullifier(value: u64) -> Nullifier {
    Option::<Nullifier>::from(Nullifier::from_bytes(&pallas::Base::from(value).to_repr())).unwrap()
}

fn compact_zsa_action(note: Note, nullifier: Nullifier) -> Vec<u8> {
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let encryptor = NoteEncryption::<OrchardDomain<OrchardZSA>>::new(None, note, [0; 512]);
    let ephemeral_key = OrchardDomain::<OrchardZSA>::epk_bytes(encryptor.epk());
    let ciphertext = encryptor.encrypt_note_plaintext();
    let compact_ciphertext =
        <OrchardZSA as OrchardPrimitives>::CompactNoteCiphertextBytes::from_slice(
            &ciphertext.as_ref()[..OrchardZSA::COMPACT_NOTE_SIZE],
        )
        .unwrap();
    let mut packed = Vec::with_capacity(1 + 32 + 32 + 32 + 1 + OrchardZSA::COMPACT_NOTE_SIZE);
    packed.push(1);
    packed.extend_from_slice(&nullifier.to_bytes());
    packed.extend_from_slice(&cmx.to_bytes());
    packed.extend_from_slice(&ephemeral_key.0);
    packed.push(OrchardZSA::COMPACT_NOTE_SIZE as u8);
    packed.extend_from_slice(compact_ciphertext.as_ref());
    packed
}

fn packed_issuance_note(note: Note) -> Vec<u8> {
    let mut packed = Vec::with_capacity(180);
    packed.push(3);
    packed.extend_from_slice(&ExtractedNoteCommitment::from(note.commitment()).to_bytes());
    packed.extend_from_slice(&note.asset().to_bytes());
    packed.extend_from_slice(&note.recipient().to_raw_address_bytes());
    packed.extend_from_slice(&note.value().inner().to_le_bytes());
    packed.extend_from_slice(&note.rho().to_bytes());
    packed.extend_from_slice(note.rseed().as_bytes());
    packed
}

fn scanner_fixture(spend_second: bool) -> (ClaimSpec, [u8; 32], Vec<u8>) {
    let mut rng = OsRng;
    let sk = loop {
        let mut bytes = [0; 32];
        rng.fill_bytes(&mut bytes);
        if let Some(sk) = Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
            break sk;
        }
    };
    let fvk = FullViewingKey::from(&sk);
    let address = fvk.address_at(0u32, Scope::External);
    let mut spec = claim();
    let issuer = IssueValidatingKey::<ZSASchnorr>::decode(&spec.asset_id[1..34]).unwrap();
    let asset_id = AssetId::new_v0(&issuer, &[7; 32]);
    let asset = AssetBase::custom(&asset_id);
    let first_old_nf = test_nullifier(1);
    let second_old_nf = test_nullifier(2);
    let first = Note::new(
        address,
        NoteValue::from_raw(250),
        asset,
        Rho::from_nf_old(first_old_nf),
        &mut rng,
    );
    let second = Note::new(
        address,
        NoteValue::from_raw(150),
        asset,
        Rho::from_nf_old(second_old_nf),
        &mut rng,
    );
    let other_sk = loop {
        let mut bytes = [0; 32];
        rng.fill_bytes(&mut bytes);
        if let Some(sk) = Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
            break sk;
        }
    };
    let other_fvk = FullViewingKey::from(&other_sk);
    let other_address = other_fvk.address_at(0u32, Scope::External);
    let first_nf = first.nullifier(&fvk).to_bytes();
    let second_nf = second.nullifier(&fvk).to_bytes();
    let first_spend = Option::<Nullifier>::from(Nullifier::from_bytes(&first_nf)).unwrap();
    let second_spend = Option::<Nullifier>::from(Nullifier::from_bytes(&second_nf)).unwrap();
    let other_first = Note::new(
        other_address,
        NoteValue::from_raw(500),
        asset,
        Rho::from_nf_old(first_spend),
        &mut rng,
    );
    let other_second = Note::new(
        other_address,
        NoteValue::from_raw(500),
        asset,
        Rho::from_nf_old(second_spend),
        &mut rng,
    );
    let actions = if spend_second {
        vec![
            compact_zsa_action(first, first_old_nf),
            compact_zsa_action(second, second_old_nf),
            compact_zsa_action(other_first, first_spend),
            compact_zsa_action(other_second, second_spend),
        ]
    } else {
        vec![
            compact_zsa_action(first, first_old_nf),
            compact_zsa_action(second, second_old_nf),
            compact_zsa_action(other_first, first_spend),
        ]
    };
    let nullifiers: Vec<[u8; 32]> = actions
        .iter()
        .map(|action| {
            Option::<Nullifier>::from(Nullifier::from_bytes(action[1..33].try_into().unwrap()))
                .unwrap()
                .to_bytes()
        })
        .collect();
    let mut frontier = Frontier::<MerkleHashOrchard, 32>::empty();
    for (index, action) in actions.iter().enumerate() {
        let cmx = ExtractedNoteCommitment::from_bytes(action[33..65].try_into().unwrap()).unwrap();
        assert!(frontier.append(MerkleHashOrchard::from_cmx(&cmx)));
        if index == 0 {
            assert!(frontier.append(MerkleHashOrchard::from_cmx(&cmx)));
        }
    }
    let exclusion_tree = ExclusionTree::from_nullifiers(nullifiers).unwrap();
    spec.snapshot_height = actions.len() as u32;
    spec.commitment_root = frontier.root().to_bytes();
    spec.exclusion_root = exclusion_tree.root();
    (spec, *sk.to_bytes(), {
        let mut packed = Vec::new();
        for (index, action) in actions.into_iter().enumerate() {
            packed.extend(action);
            if index == 0 {
                packed.push(2);
                packed.extend_from_slice(&packed[33..65].to_vec());
            }
        }
        packed
    })
}

fn assert_scanner_decrypts_an_eligible_note(spending_key: [u8; 32], packed_actions: &[u8]) {
    let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes(spending_key)).unwrap();
    let fvk = FullViewingKey::from(&sk);
    let ciphertext_len = usize::from(packed_actions[97]);
    let nullifier = Option::<Nullifier>::from(Nullifier::from_bytes(
        packed_actions[1..33].try_into().unwrap(),
    ))
    .unwrap();
    let cmx = Option::<ExtractedNoteCommitment>::from(ExtractedNoteCommitment::from_bytes(
        packed_actions[33..65].try_into().unwrap(),
    ))
    .unwrap();
    let ciphertext = <OrchardZSA as OrchardPrimitives>::CompactNoteCiphertextBytes::from_slice(
        &packed_actions[98..98 + ciphertext_len],
    )
    .unwrap();
    let action = CompactAction::<OrchardZSA>::from_parts(
        nullifier,
        cmx,
        EphemeralKeyBytes(packed_actions[65..97].try_into().unwrap()),
        ciphertext,
    );
    let domain = OrchardDomain::<OrchardZSA>::for_compact_action(&action);
    assert!(
        try_compact_note_decryption(
            &domain,
            &orchard::keys::PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::External)),
            &action,
        )
        .is_some()
    );
}

#[test]
fn canonical_claim_id_and_domain_are_deterministic() {
    let spec = claim();
    assert_eq!(spec.claim_id().unwrap(), spec.claim_id().unwrap());
    assert_eq!(spec.claim_domain().unwrap(), spec.claim_domain().unwrap());
}

#[test]
fn claim_id_binds_every_public_claim_field() {
    let original = claim().claim_id().unwrap();
    let mut variants = Vec::new();

    let mut spec = claim();
    spec.network_id = "another-network".to_owned();
    variants.push(spec);
    let mut spec = claim();
    spec.asset_id[65] ^= 1;
    variants.push(spec);
    let mut spec = claim();
    spec.threshold += 1;
    variants.push(spec);
    let mut spec = claim();
    spec.snapshot_height += 1;
    variants.push(spec);
    let mut spec = claim();
    spec.commitment_root[0] ^= 1;
    variants.push(spec);
    let mut spec = claim();
    spec.exclusion_root[0] ^= 1;
    variants.push(spec);
    let mut spec = claim();
    spec.expires_at = Some(spec.expires_at.unwrap() + 1);
    variants.push(spec);
    let mut spec = claim();
    spec.expires_at = None;
    variants.push(spec);
    let mut spec = claim();
    spec.creator_nonce[0] ^= 1;
    variants.push(spec);

    assert!(
        variants
            .into_iter()
            .all(|spec| spec.claim_id().unwrap() != original)
    );
}

#[test]
fn claim_domain_is_separated_by_claim_id_and_network() {
    let first = claim();
    let first_domain = first.claim_domain().unwrap();

    let mut second = claim();
    second.creator_nonce[0] ^= 1;
    assert_ne!(first_domain, second.claim_domain().unwrap());

    let mut another_network = claim();
    another_network.network_id = "another-network".to_owned();
    assert_ne!(first_domain, another_network.claim_domain().unwrap());
}

#[test]
fn invalid_claim_metadata_is_rejected() {
    let mut spec = claim();
    spec.network_id.clear();
    assert_eq!(spec.validate(), Err(ClaimError::EmptyNetworkId));

    let mut spec = claim();
    spec.asset_id[0] = 1;
    assert_eq!(spec.validate(), Err(ClaimError::InvalidAssetId));

    let mut spec = claim();
    spec.threshold = 0;
    assert_eq!(spec.validate(), Err(ClaimError::ZeroThreshold));

    let mut spec = claim();
    spec.commitment_root = [0xff; 32];
    assert_eq!(spec.validate(), Err(ClaimError::InvalidCommitmentRoot));

    let mut spec = claim();
    spec.exclusion_root = [0xff; 32];
    assert_eq!(spec.validate(), Err(ClaimError::InvalidExclusionRoot));
}

#[test]
fn circuit_public_inputs_are_derived_from_the_validated_claim() {
    let spec = claim();
    let alternate_nullifier = pallas::Base::from(2).to_repr();
    let randomized_spend_key = pallas::Point::generator().to_bytes();
    let inputs = spec
        .circuit_public_inputs(alternate_nullifier, randomized_spend_key)
        .unwrap();

    assert_eq!(inputs[0], pallas::Base::from(2));
    assert_eq!(inputs[1].to_repr(), spec.claim_domain().unwrap());
    assert_eq!(inputs[2], pallas::Base::from(spec.threshold));
    assert_eq!(inputs[5].to_repr(), spec.commitment_root);
    let spend_coordinates: pasta_curves::arithmetic::Coordinates<pallas::Affine> = Option::from(
        Option::<pallas::Point>::from(pallas::Point::from_bytes(&randomized_spend_key))
            .unwrap()
            .to_affine()
            .coordinates(),
    )
    .unwrap();
    assert_eq!(inputs[7], *spend_coordinates.x());
    assert_eq!(inputs[8], *spend_coordinates.y());

    assert_eq!(
        spec.circuit_public_inputs([0xff; 32], randomized_spend_key),
        Err(ClaimError::InvalidAlternateNullifier)
    );
    assert_eq!(
        spec.circuit_public_inputs(alternate_nullifier, [0; 32]),
        Err(ClaimError::InvalidSpendAuthKey)
    );
}

#[test]
fn claim_proof_rejects_an_unsupported_bundle_version() {
    assert_eq!(
        ClaimProof::from_bytes(b"HCP2"),
        Err(ClaimProofError::UnsupportedVersion)
    );
}

#[test]
fn browser_scanner_rejects_empty_or_misaligned_action_bytes() {
    assert_eq!(
        prove_scanned_single_note_claim(&claim(), [0; 32], &[]),
        Err(horoi_claim::NoteProofError::InvalidCompactActions)
    );
    let malformed = vec![0; 32 + 32 + 32 + 84 + 1];
    assert_eq!(
        prove_scanned_single_note_claim(&claim(), [0; 32], &malformed),
        Err(horoi_claim::NoteProofError::InvalidCompactActions)
    );
}

#[test]
fn browser_scanner_skips_a_spent_eligible_note_and_proves_the_next_one() {
    let (spec, spending_key, packed_actions) = scanner_fixture(false);
    assert_scanner_decrypts_an_eligible_note(spending_key, &packed_actions[215..]);
    let proof_bytes =
        prove_scanned_single_note_claim(&spec, spending_key, &packed_actions).unwrap();
    let proof = ClaimProof::from_bytes(&proof_bytes).unwrap();
    ClaimVerifier::verify(&spec, &proof).unwrap();
}

#[test]
fn browser_scanner_rejects_when_all_eligible_notes_are_spent() {
    let (spec, spending_key, packed_actions) = scanner_fixture(true);
    assert_eq!(
        prove_scanned_single_note_claim(&spec, spending_key, &packed_actions),
        Err(NoteProofError::NoEligibleNote)
    );
}

#[test]
fn browser_scanner_rejects_insufficient_balance() {
    let (mut spec, spending_key, packed_actions) = scanner_fixture(false);
    spec.threshold = 401;
    assert_eq!(
        prove_scanned_single_note_claim(&spec, spending_key, &packed_actions),
        Err(NoteProofError::NoEligibleNote)
    );
}

#[test]
fn browser_scanner_reconstructs_and_proves_a_public_issuance_note() {
    let mut rng = OsRng;
    let spending_key = loop {
        let mut bytes = [0; 32];
        rng.fill_bytes(&mut bytes);
        if let Some(spending_key) = Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
            break spending_key;
        }
    };
    let fvk = FullViewingKey::from(&spending_key);
    let recipient = fvk.address_at(0u32, Scope::External);
    let mut spec = claim();
    let issuer = IssueValidatingKey::<ZSASchnorr>::decode(&spec.asset_id[1..34]).unwrap();
    let asset_id = AssetId::new_v0(&issuer, &[7; 32]);
    let asset = AssetBase::custom(&asset_id);
    let issuance_note = Note::new(
        recipient,
        NoteValue::from_raw(250),
        asset,
        Rho::from_nf_old(test_nullifier(45)),
        &mut rng,
    );
    let other_spending_key = loop {
        let mut bytes = [0; 32];
        rng.fill_bytes(&mut bytes);
        if let Some(spending_key) = Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
            break spending_key;
        }
    };
    let other_fvk = FullViewingKey::from(&other_spending_key);
    let old_nullifier = test_nullifier(44);
    let public_action = compact_zsa_action(
        Note::new(
            other_fvk.address_at(0u32, Scope::External),
            NoteValue::from_raw(1),
            asset,
            Rho::from_nf_old(old_nullifier),
            &mut rng,
        ),
        old_nullifier,
    );
    let issuance_record = packed_issuance_note(issuance_note);
    let mut frontier = Frontier::<MerkleHashOrchard, 32>::empty();
    let action_cmx =
        ExtractedNoteCommitment::from_bytes(public_action[33..65].try_into().unwrap()).unwrap();
    let issuance_cmx =
        ExtractedNoteCommitment::from_bytes(issuance_record[1..33].try_into().unwrap()).unwrap();
    assert!(frontier.append(MerkleHashOrchard::from_cmx(&action_cmx)));
    assert!(frontier.append(MerkleHashOrchard::from_cmx(&issuance_cmx)));
    let exclusion_tree = ExclusionTree::from_nullifiers(vec![old_nullifier.to_bytes()]).unwrap();
    spec.snapshot_height = 2;
    spec.commitment_root = frontier.root().to_bytes();
    spec.exclusion_root = exclusion_tree.root();
    let issuance_offset = public_action.len();
    let packed_actions = [public_action, issuance_record].concat();

    let proof_bytes =
        prove_scanned_single_note_claim(&spec, *spending_key.to_bytes(), &packed_actions).unwrap();
    ClaimVerifier::verify(&spec, &ClaimProof::from_bytes(&proof_bytes).unwrap()).unwrap();

    let mut tampered = packed_actions;
    tampered[issuance_offset + 1] ^= 1;
    assert_eq!(
        prove_scanned_single_note_claim(&spec, *spending_key.to_bytes(), &tampered),
        Err(NoteProofError::InvalidCompactActions)
    );
}

#[test]
fn alternate_nullifier_is_stable_and_domain_separated() {
    let nk = pallas::Base::from(2).to_repr();
    let standard_nullifier = pallas::Base::from(3).to_repr();
    let domain_a = pallas::Base::from(5).to_repr();
    let domain_b = pallas::Base::from(6).to_repr();

    let a = derive_alternate_nullifier(&nk, &standard_nullifier, &domain_a).unwrap();
    assert_eq!(
        a,
        derive_alternate_nullifier(&nk, &standard_nullifier, &domain_a).unwrap()
    );
    assert_ne!(
        a,
        derive_alternate_nullifier(&nk, &standard_nullifier, &domain_b).unwrap()
    );
}

#[test]
fn alternate_nullifier_rejects_noncanonical_fields() {
    let valid = pallas::Base::from(1).to_repr();
    assert_eq!(
        derive_alternate_nullifier(&[0xff; 32], &valid, &valid),
        Err(ZsaError::InvalidNullifierKey)
    );
    assert_eq!(
        derive_alternate_nullifier(&valid, &valid, &[0xff; 32]),
        Err(ZsaError::InvalidClaimDomain)
    );
}

#[test]
fn asset_base_is_derived_from_the_canonical_asset_id() {
    let first = claim();
    let first_base = first.asset_base().unwrap();
    assert_eq!(first_base, first.asset_base().unwrap());

    let mut second = claim();
    second.asset_id[65] ^= 1;
    assert_ne!(first_base, second.asset_base().unwrap());
}

#[test]
fn orchard_note_alternate_nullifier_uses_the_note_and_domain() {
    let mut rng = OsRng;
    let sk = loop {
        let mut bytes = [0; 32];
        rng.fill_bytes(&mut bytes);
        if let Some(sk) = Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
            break sk;
        }
    };
    let fvk = FullViewingKey::from(&sk);
    let address = fvk.address_at(0u32, Scope::External);
    let rho = Rho::from_bytes(&pallas::Base::from(11).to_repr()).unwrap();
    let issuer = IssueValidatingKey::<ZSASchnorr>::decode(&[
        0, 0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62, 0x95, 0xce, 0x87,
        0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b, 0x16,
        0xf8, 0x17, 0x98,
    ])
    .unwrap();
    let public_asset_id = asset_id([7; 32]);
    let orchard_asset_id = orchard::note::AssetId::new_v0(&issuer, &[7; 32]);
    let asset = orchard::note::AssetBase::custom(&orchard_asset_id);
    let note = Note::new(address, NoteValue::from_raw(10_123), asset, rho, &mut rng);
    let asset_base_bytes = derive_asset_base(&public_asset_id).unwrap();
    let asset_base =
        Option::<pallas::Point>::from(pallas::Point::from_bytes(&asset_base_bytes)).unwrap();
    assert_eq!(asset_base.to_bytes(), asset_base_bytes);
    let asset_coordinates = asset_base.to_affine().coordinates().unwrap();
    let asset_x = *asset_coordinates.x();
    let asset_y = *asset_coordinates.y();
    let merkle_path = MerklePath::from_parts(
        1,
        core::array::from_fn(|index| {
            let sibling = pallas::Base::from(index as u64 + 20).to_repr();
            Option::<MerkleHashOrchard>::from(MerkleHashOrchard::from_bytes(&sibling)).unwrap()
        }),
    );
    let snapshot_root = Option::<pallas::Base>::from(pallas::Base::from_repr(
        merkle_path
            .root(ExtractedNoteCommitment::from(note.commitment()))
            .to_bytes(),
    ))
    .unwrap();
    let mut spec = claim();
    spec.commitment_root = snapshot_root.to_repr();
    let exclusion_tree = ExclusionTree::from_nullifiers([]).unwrap();
    let exclusion_root = exclusion_tree.root();
    spec.exclusion_root = exclusion_root;
    let exclusion_witness = exclusion_tree
        .witness(note.nullifier(&fvk).to_bytes())
        .unwrap();
    let domain_a_bytes = spec.claim_domain().unwrap();
    let domain_a = Option::<pallas::Base>::from(pallas::Base::from_repr(domain_a_bytes)).unwrap();
    let mut another_claim = spec.clone();
    another_claim.creator_nonce[0] ^= 1;
    let domain_b_bytes = another_claim.claim_domain().unwrap();
    let domain_b = Option::<pallas::Base>::from(pallas::Base::from_repr(domain_b_bytes)).unwrap();
    let alt_a = derive_note_alternate_nullifier(&note, &fvk, &domain_a_bytes).unwrap();
    let alt_a_field = Option::<pallas::Base>::from(pallas::Base::from_repr(alt_a)).unwrap();
    let spend_auth_randomizer = pallas::Scalar::from(17);
    let randomized_spend_key = derive_randomized_spend_key(&fvk, &spend_auth_randomizer).unwrap();
    assert_eq!(
        derive_randomized_spend_key(&fvk, &pallas::Scalar::zero()),
        Err(ZsaError::InvalidSpendAuthRandomizer)
    );
    assert!(matches!(
        NoteCommitmentCircuit::new(
            note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            100,
            Scope::External,
            pallas::Scalar::zero(),
            merkle_path.clone(),
            exclusion_witness.clone(),
        ),
        Err(ZsaError::InvalidSpendAuthRandomizer)
    ));
    let circuit = NoteCommitmentCircuit::new(
        note.clone(),
        fvk.clone(),
        domain_a,
        pallas::Base::from_repr(exclusion_root).unwrap(),
        100,
        Scope::External,
        spend_auth_randomizer,
        merkle_path.clone(),
        exclusion_witness.clone(),
    )
    .unwrap();
    let public_inputs = spec
        .circuit_public_inputs(alt_a, randomized_spend_key)
        .unwrap();
    assert_eq!(public_inputs.len(), 9);
    let private_leaf = ExtractedNoteCommitment::from(note.commitment()).inner();
    assert!(!public_inputs.contains(&private_leaf));
    assert_eq!(public_inputs[0], alt_a_field);
    assert_eq!(public_inputs[3], asset_x);
    assert_eq!(public_inputs[4], asset_y);
    assert_eq!(public_inputs[5], snapshot_root);
    assert_eq!(public_inputs[6].to_repr(), exclusion_root);
    let authorization_message = spec.spend_authorization_message(alt_a).unwrap();
    let (authorization_key, authorization_bytes) =
        create_spend_authorization(&sk, &spend_auth_randomizer, &authorization_message).unwrap();
    assert_eq!(authorization_key, randomized_spend_key);
    assert_eq!(
        verify_spend_authorization(
            randomized_spend_key,
            &authorization_message,
            authorization_bytes,
        ),
        Ok(())
    );
    assert_eq!(
        verify_spend_authorization(
            randomized_spend_key,
            b"different claim statement",
            authorization_bytes,
        ),
        Err(ZsaError::InvalidSpendAuthSignature)
    );
    let prover = MockProver::run(13, &circuit, vec![public_inputs.to_vec()]).unwrap();
    assert_eq!(prover.verify(), Ok(()));

    let proof_started = Instant::now();
    let merkle_path_bytes: Vec<u8> = merkle_path
        .auth_path()
        .iter()
        .flat_map(|node| node.to_bytes())
        .collect();
    let serialized = prove_single_note_claim(
        &spec,
        *sk.to_bytes(),
        note.value().inner(),
        note.rho().into_inner().to_repr(),
        *note.rseed().as_bytes(),
        0,
        0,
        merkle_path.position(),
        &merkle_path_bytes,
        exclusion_witness.clone(),
    )
    .unwrap();
    let proof_elapsed = proof_started.elapsed();
    let claim_proof = ClaimProof::from_bytes(&serialized).unwrap();
    if std::env::var_os("HOROI_MEASURE_PROOF").is_some() {
        eprintln!(
            "HOROI_CLAIM_PROOF_SETUP_AND_PROVE_MS={} proof_bytes={}",
            proof_elapsed.as_millis(),
            serialized.len() - 392
        );
    }
    let decoded_proof = ClaimProof::from_bytes(&serialized).unwrap();
    assert_eq!(decoded_proof, claim_proof);
    ClaimVerifier::verify(&spec, &decoded_proof).unwrap();

    let mut tampered_proof = serialized.clone();
    tampered_proof[392] ^= 1;
    let tampered_proof = ClaimProof::from_bytes(&tampered_proof).unwrap();
    assert_eq!(
        ClaimVerifier::verify(&spec, &tampered_proof),
        Err(ClaimProofError::ProofVerificationFailed)
    );

    let mut altered_public_inputs = serialized.clone();
    altered_public_inputs[72] ^= 1;
    let altered_public_inputs = ClaimProof::from_bytes(&altered_public_inputs).unwrap();
    assert_eq!(
        ClaimVerifier::verify(&spec, &altered_public_inputs),
        Err(ClaimProofError::InvalidEncoding)
    );

    let mut altered_signature = serialized.clone();
    altered_signature[328] ^= 1;
    let altered_signature = ClaimProof::from_bytes(&altered_signature).unwrap();
    assert_eq!(
        ClaimVerifier::verify(&spec, &altered_signature),
        Err(ClaimProofError::InvalidSpendAuthSignature)
    );

    let mut wrong_claim = spec.clone();
    wrong_claim.creator_nonce[0] ^= 1;
    assert_eq!(
        ClaimVerifier::verify(&wrong_claim, &claim_proof),
        Err(ClaimProofError::InvalidEncoding)
    );
    let mut wrong_asset = spec.clone();
    wrong_asset.asset_id[65] ^= 1;
    assert_eq!(
        ClaimVerifier::verify(&wrong_asset, &claim_proof),
        Err(ClaimProofError::InvalidEncoding)
    );
    let mut wrong_snapshot = spec.clone();
    wrong_snapshot.snapshot_height += 1;
    assert_eq!(
        ClaimVerifier::verify(&wrong_snapshot, &claim_proof),
        Err(ClaimProofError::InvalidEncoding)
    );
    let mut wrong_root = spec.clone();
    wrong_root.commitment_root[0] ^= 1;
    assert_eq!(
        ClaimVerifier::verify(&wrong_root, &claim_proof),
        Err(ClaimProofError::InvalidEncoding)
    );
    let mut wrong_exclusion_root = spec.clone();
    wrong_exclusion_root.exclusion_root[0] ^= 1;
    assert_eq!(
        ClaimVerifier::verify(&wrong_exclusion_root, &claim_proof),
        Err(ClaimProofError::InvalidEncoding)
    );
    let mut wrong_threshold = spec.clone();
    wrong_threshold.threshold += 1;
    assert_eq!(
        ClaimVerifier::verify(&wrong_threshold, &claim_proof),
        Err(ClaimProofError::InvalidEncoding)
    );
    let mut wrong_nullifier_inputs = public_inputs;
    wrong_nullifier_inputs[0] = alt_a_field + pallas::Base::one();
    let wrong_nullifier = MockProver::run(
        13,
        &NoteCommitmentCircuit::new(
            note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            100,
            Scope::External,
            spend_auth_randomizer,
            merkle_path.clone(),
            exclusion_witness.clone(),
        )
        .unwrap(),
        vec![wrong_nullifier_inputs.to_vec()],
    )
    .unwrap();
    assert!(wrong_nullifier.verify().is_err());
    let mut wrong_domain_inputs = public_inputs;
    wrong_domain_inputs[1] = domain_b;
    let wrong_domain = MockProver::run(
        13,
        &NoteCommitmentCircuit::new(
            note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            100,
            Scope::External,
            spend_auth_randomizer,
            merkle_path.clone(),
            exclusion_witness.clone(),
        )
        .unwrap(),
        vec![wrong_domain_inputs.to_vec()],
    )
    .unwrap();
    assert!(wrong_domain.verify().is_err());
    let mut wrong_randomized_key = public_inputs;
    wrong_randomized_key[7] += pallas::Base::one();
    let prover = MockProver::run(13, &circuit, vec![wrong_randomized_key.to_vec()]).unwrap();
    assert!(prover.verify().is_err());

    #[cfg(feature = "test-utils")]
    {
        let underflow_slack = pallas::Base::zero() - pallas::Base::one();
        let malicious_threshold = NoteCommitmentCircuit::with_private_witnesses(
            note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            10_124,
            Scope::External,
            spend_auth_randomizer,
            pallas::Base::from(11),
            underflow_slack,
            merkle_path.clone(),
            exclusion_witness.clone(),
        )
        .unwrap();
        let mut malicious_threshold_inputs = public_inputs;
        malicious_threshold_inputs[2] = pallas::Base::from(10_124);
        let prover = MockProver::run(
            13,
            &malicious_threshold,
            vec![malicious_threshold_inputs.to_vec()],
        )
        .unwrap();
        assert!(prover.verify().is_err());

        let mismatched_rho = NoteCommitmentCircuit::with_private_witnesses(
            note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            100,
            Scope::External,
            spend_auth_randomizer,
            pallas::Base::from(99),
            pallas::Base::from(10_023),
            merkle_path.clone(),
            exclusion_witness.clone(),
        )
        .unwrap();
        let prover = MockProver::run(13, &mismatched_rho, vec![public_inputs.to_vec()]).unwrap();
        assert!(prover.verify().is_err());

        let unrelated_sk = loop {
            let mut bytes = [0; 32];
            rng.fill_bytes(&mut bytes);
            if let Some(sk) = Option::<SpendingKey>::from(SpendingKey::from_bytes(bytes)) {
                break sk;
            }
        };
        let unrelated_fvk = FullViewingKey::from(&unrelated_sk);
        assert!(matches!(
            NoteCommitmentCircuit::new(
                note.clone(),
                unrelated_fvk,
                domain_a,
                pallas::Base::from_repr(exclusion_root).unwrap(),
                100,
                Scope::External,
                spend_auth_randomizer,
                merkle_path.clone(),
                exclusion_witness.clone(),
            ),
            Err(ZsaError::InvalidNoteCommitment)
        ));

        let different_path = MerklePath::from_parts(
            2,
            core::array::from_fn(|index| {
                let sibling = pallas::Base::from(index as u64 + 80).to_repr();
                Option::<MerkleHashOrchard>::from(MerkleHashOrchard::from_bytes(&sibling)).unwrap()
            }),
        );
        let wrong_path = NoteCommitmentCircuit::new(
            note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            100,
            Scope::External,
            spend_auth_randomizer,
            different_path,
            exclusion_witness.clone(),
        )
        .unwrap();
        let prover = MockProver::run(13, &wrong_path, vec![public_inputs.to_vec()]).unwrap();
        assert!(prover.verify().is_err());
    }

    let alt_a = derive_note_alternate_nullifier(&note, &fvk, &domain_a_bytes).unwrap();
    assert_eq!(
        alt_a,
        derive_note_alternate_nullifier(&note, &fvk, &domain_a_bytes).unwrap()
    );
    assert_ne!(
        alt_a,
        derive_note_alternate_nullifier(&note, &fvk, &domain_b_bytes).unwrap()
    );
    assert_ne!(alt_a, note.nullifier(&fvk).to_bytes());

    let split_note = note.clone().create_split_note(&mut rng);
    assert!(matches!(
        NoteCommitmentCircuit::new(
            split_note.clone(),
            fvk.clone(),
            domain_a,
            pallas::Base::from_repr(exclusion_root).unwrap(),
            100,
            Scope::External,
            spend_auth_randomizer,
            merkle_path,
            exclusion_witness.clone(),
        ),
        Err(ZsaError::UnsupportedSplitNote)
    ));
    assert_ne!(
        alt_a,
        derive_note_alternate_nullifier(&split_note, &fvk, &domain_a_bytes).unwrap()
    );
    assert_ne!(
        derive_note_alternate_nullifier(&split_note, &fvk, &domain_a_bytes).unwrap(),
        split_note.nullifier(&fvk).to_bytes()
    );
}

#[test]
fn claim_id_and_domain_have_stable_v1_vectors() {
    let spec = claim();
    let claim_id = spec
        .claim_id()
        .unwrap()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let claim_domain = spec
        .claim_domain()
        .unwrap()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    assert_eq!(
        claim_id,
        "4974b838f3c292395303e45b4104539aaab8b2ab9a6ded467728287a2eae9c0f"
    );
    assert_eq!(
        claim_domain,
        "8132a489c0c0e68f7fa50e02c75407decebe0690c135c8e972944c7da6204300"
    );

    let mut without_expiration = spec.clone();
    without_expiration.expires_at = None;
    assert_ne!(
        spec.claim_id().unwrap(),
        without_expiration.claim_id().unwrap()
    );
}

#[test]
fn exclusion_tree_is_deterministic_and_proves_only_unspent_nullifiers() {
    let spent = [1_u64, 4, 9].map(|value| pallas::Base::from(value).to_repr());
    let tree = ExclusionTree::from_nullifiers(spent).unwrap();
    let reordered =
        ExclusionTree::from_nullifiers([spent[2], spent[0], spent[1], spent[1]]).unwrap();
    assert_eq!(tree.root(), reordered.root());

    let unspent = pallas::Base::from(3).to_repr();
    let witness = tree.witness(unspent).unwrap();
    tree.verify_witness(unspent, &witness).unwrap();
    verify_exclusion_witness(tree.root(), unspent, &witness).unwrap();
    assert_eq!(tree.witness(spent[1]), Err(ExclusionError::InvalidWitness));

    let mut tampered = witness;
    tampered.interval.width = pallas::Base::from(4).to_repr();
    assert_eq!(
        verify_exclusion_witness(tree.root(), unspent, &tampered),
        Err(ExclusionError::InvalidWitness)
    );
    let mut empty_leaf = tree.witness(unspent).unwrap();
    empty_leaf.interval.low = pallas::Base::zero().to_repr();
    empty_leaf.interval.width = pallas::Base::zero().to_repr();
    assert_eq!(
        verify_exclusion_witness(tree.root(), unspent, &empty_leaf),
        Err(ExclusionError::InvalidWitness)
    );

    let mut invalid_position = tree.witness(unspent).unwrap();
    invalid_position.position += 1 << EXCLUSION_TREE_DEPTH;
    assert_eq!(
        verify_exclusion_witness(tree.root(), unspent, &invalid_position),
        Err(ExclusionError::InvalidWitness)
    );
}

#[test]
fn exclusion_tree_handles_empty_and_boundary_sets() {
    let empty = ExclusionTree::from_nullifiers([]).unwrap();
    let max = (-pallas::Base::one()).to_repr();
    empty
        .verify_witness(max, &empty.witness(max).unwrap())
        .unwrap();
    assert_eq!(
        empty.witness(pallas::Base::zero().to_repr()),
        Err(ExclusionError::InvalidWitness)
    );

    let zero = pallas::Base::from(0).to_repr();
    let max = (-pallas::Base::one()).to_repr();
    let tree = ExclusionTree::from_nullifiers([zero, max]).unwrap();
    assert!(tree.intervals().len() > 1);
    let middle = pallas::Base::from(1).to_repr();
    tree.verify_witness(middle, &tree.witness(middle).unwrap())
        .unwrap();
    assert_eq!(tree.witness(zero), Err(ExclusionError::InvalidWitness));
    assert_eq!(tree.witness(max), Err(ExclusionError::InvalidWitness));
}
