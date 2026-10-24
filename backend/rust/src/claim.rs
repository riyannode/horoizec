use blake2b_simd::Params;
use ff::{FromUniformBytes, PrimeField};
use group::{Curve, Group, GroupEncoding};
use halo2_proofs::{
    plonk::{SingleVerifier, create_proof, keygen_pk, keygen_vk, verify_proof},
    poly::commitment::Params as HaloParams,
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use pasta_curves::arithmetic::CurveAffine;
use pasta_curves::{pallas, vesta};
use rand::rngs::OsRng;
use std::sync::OnceLock;

use crate::{NoteCommitmentCircuit, derive_asset_base};

const PROTOCOL_VERSION: u8 = 1;
const CLAIM_ID_PERSONALIZATION: &[u8; 16] = b"HoroiClaimIDv1__";
const CLAIM_DOMAIN_PERSONALIZATION: &[u8; 16] = b"HoroiDomainV1___";
const SPEND_AUTH_PERSONALIZATION: &[u8; 16] = b"HoroiSpendAuthV1";
const CLAIM_DOMAIN_LABEL: &[u8] = b"horoi-claim-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaimError {
    EmptyNetworkId,
    NetworkIdTooLong,
    ZeroThreshold,
    InvalidAssetId,
    InvalidCommitmentRoot,
    InvalidExclusionRoot,
    InvalidAlternateNullifier,
    InvalidSpendAuthKey,
    InvalidClaimDomain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaimProofError {
    InvalidClaim(ClaimError),
    InvalidEncoding,
    InvalidSpendAuthKey,
    InvalidSpendAuthSignature,
    UnsupportedVersion,
    ProofTooLarge,
    SetupFailed,
    ProofCreationFailed,
    ProofVerificationFailed,
}

const CLAIM_PROOF_MAGIC: &[u8; 4] = b"HCP1";
const CLAIM_PROOF_FIXED_BYTES: usize = 4 + 4 + 9 * 32 + 32 + 64;
const MAX_CLAIM_PROOF_BYTES: usize = 1 << 20;
const CLAIM_CIRCUIT_K: u32 = 13;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimProof {
    public_inputs: [[u8; 32]; 9],
    randomized_spend_key: [u8; 32],
    spend_authorization: [u8; 64],
    proof: Vec<u8>,
}

type ClaimProvingKey = (
    HaloParams<vesta::Affine>,
    halo2_proofs::plonk::ProvingKey<vesta::Affine>,
);

static CLAIM_PROVING_KEY: OnceLock<Result<ClaimProvingKey, ClaimProofError>> = OnceLock::new();

fn claim_proving_key() -> Result<&'static ClaimProvingKey, ClaimProofError> {
    CLAIM_PROVING_KEY
        .get_or_init(|| {
            let params = HaloParams::<vesta::Affine>::new(CLAIM_CIRCUIT_K);
            let circuit = NoteCommitmentCircuit::blank();
            let vk = keygen_vk(&params, &circuit).map_err(|_| ClaimProofError::SetupFailed)?;
            let pk = keygen_pk(&params, vk, &circuit).map_err(|_| ClaimProofError::SetupFailed)?;
            Ok((params, pk))
        })
        .as_ref()
        .map_err(|error| *error)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimSpec {
    pub network_id: String,
    pub asset_id: Vec<u8>,
    pub threshold: u64,
    pub snapshot_height: u32,
    pub commitment_root: [u8; 32],
    pub exclusion_root: [u8; 32],
    pub expires_at: Option<u64>,
    pub creator_nonce: [u8; 32],
}

impl ClaimSpec {
    pub fn validate(&self) -> Result<(), ClaimError> {
        if self.network_id.is_empty() {
            return Err(ClaimError::EmptyNetworkId);
        }
        if self.network_id.len() > usize::from(u16::MAX) {
            return Err(ClaimError::NetworkIdTooLong);
        }
        if derive_asset_base(&self.asset_id).is_err() {
            return Err(ClaimError::InvalidAssetId);
        }
        if self.threshold == 0 {
            return Err(ClaimError::ZeroThreshold);
        }
        if Option::<pallas::Base>::from(pallas::Base::from_repr(self.commitment_root)).is_none() {
            return Err(ClaimError::InvalidCommitmentRoot);
        }
        if Option::<pallas::Base>::from(pallas::Base::from_repr(self.exclusion_root)).is_none() {
            return Err(ClaimError::InvalidExclusionRoot);
        }
        Ok(())
    }

    pub fn circuit_public_inputs(
        &self,
        alternate_nullifier: [u8; 32],
        randomized_spend_key: [u8; 32],
    ) -> Result<[pallas::Base; 9], ClaimError> {
        self.validate()?;
        let alternate_nullifier =
            Option::<pallas::Base>::from(pallas::Base::from_repr(alternate_nullifier))
                .ok_or(ClaimError::InvalidAlternateNullifier)?;
        let randomized_spend_key =
            Option::<pallas::Point>::from(pallas::Point::from_bytes(&randomized_spend_key))
                .ok_or(ClaimError::InvalidSpendAuthKey)?;
        if bool::from(randomized_spend_key.is_identity()) {
            return Err(ClaimError::InvalidSpendAuthKey);
        }
        let asset_base = self.asset_base()?;
        let asset_point = Option::<pallas::Point>::from(pallas::Point::from_bytes(&asset_base))
            .ok_or(ClaimError::InvalidAssetId)?;
        let coordinates: pasta_curves::arithmetic::Coordinates<pallas::Affine> =
            Option::from(asset_point.to_affine().coordinates())
                .ok_or(ClaimError::InvalidAssetId)?;
        let domain = Option::<pallas::Base>::from(pallas::Base::from_repr(self.claim_domain()?))
            .ok_or(ClaimError::InvalidClaimDomain)?;
        let commitment_root =
            Option::<pallas::Base>::from(pallas::Base::from_repr(self.commitment_root))
                .ok_or(ClaimError::InvalidCommitmentRoot)?;
        let spend_coordinates: pasta_curves::arithmetic::Coordinates<pallas::Affine> =
            Option::from(randomized_spend_key.to_affine().coordinates())
                .ok_or(ClaimError::InvalidSpendAuthKey)?;

        Ok([
            alternate_nullifier,
            domain,
            pallas::Base::from(self.threshold),
            *coordinates.x(),
            *coordinates.y(),
            commitment_root,
            Option::<pallas::Base>::from(pallas::Base::from_repr(self.exclusion_root))
                .ok_or(ClaimError::InvalidExclusionRoot)?,
            *spend_coordinates.x(),
            *spend_coordinates.y(),
        ])
    }

    pub fn spend_authorization_message(
        &self,
        alternate_nullifier: [u8; 32],
    ) -> Result<[u8; 32], ClaimError> {
        self.validate()?;
        Option::<pallas::Base>::from(pallas::Base::from_repr(alternate_nullifier))
            .ok_or(ClaimError::InvalidAlternateNullifier)?;
        let mut preimage = self.canonical_bytes()?;
        preimage.extend_from_slice(&alternate_nullifier);
        let hash = Params::new()
            .hash_length(32)
            .personal(SPEND_AUTH_PERSONALIZATION)
            .hash(&preimage);
        let mut message = [0; 32];
        message.copy_from_slice(hash.as_bytes());
        Ok(message)
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, ClaimError> {
        self.validate()?;

        let mut bytes = Vec::with_capacity(
            1 + 2 + self.network_id.len() + 2 + self.asset_id.len() + 8 + 4 + 32 + 32 + 1 + 8 + 32,
        );
        bytes.push(PROTOCOL_VERSION);
        bytes.extend_from_slice(&(self.network_id.len() as u16).to_be_bytes());
        bytes.extend_from_slice(self.network_id.as_bytes());
        bytes.extend_from_slice(&(self.asset_id.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&self.asset_id);
        bytes.extend_from_slice(&self.threshold.to_be_bytes());
        bytes.extend_from_slice(&self.snapshot_height.to_be_bytes());
        bytes.extend_from_slice(&self.commitment_root);
        bytes.extend_from_slice(&self.exclusion_root);
        match self.expires_at {
            Some(expires_at) => {
                bytes.push(1);
                bytes.extend_from_slice(&expires_at.to_be_bytes());
            }
            None => bytes.push(0),
        }
        bytes.extend_from_slice(&self.creator_nonce);
        Ok(bytes)
    }

    pub fn asset_base(&self) -> Result<[u8; 32], ClaimError> {
        derive_asset_base(&self.asset_id).map_err(|_| ClaimError::InvalidAssetId)
    }

    pub fn claim_id(&self) -> Result<[u8; 32], ClaimError> {
        let bytes = self.canonical_bytes()?;
        let hash = Params::new()
            .hash_length(32)
            .personal(CLAIM_ID_PERSONALIZATION)
            .hash(&bytes);
        let mut claim_id = [0; 32];
        claim_id.copy_from_slice(hash.as_bytes());
        Ok(claim_id)
    }

    pub fn claim_domain(&self) -> Result<[u8; 32], ClaimError> {
        let claim_id = self.claim_id()?;
        let mut input = Vec::with_capacity(
            CLAIM_DOMAIN_LABEL.len() + 2 + self.network_id.len() + claim_id.len(),
        );
        input.extend_from_slice(CLAIM_DOMAIN_LABEL);
        input.extend_from_slice(&(self.network_id.len() as u16).to_be_bytes());
        input.extend_from_slice(self.network_id.as_bytes());
        input.extend_from_slice(&claim_id);

        let hash = Params::new()
            .hash_length(64)
            .personal(CLAIM_DOMAIN_PERSONALIZATION)
            .hash(&input);
        let mut wide = [0; 64];
        wide.copy_from_slice(hash.as_bytes());
        Ok(pallas::Base::from_uniform_bytes(&wide).to_repr())
    }
}

impl ClaimProof {
    pub fn create(
        spec: &ClaimSpec,
        circuit: &NoteCommitmentCircuit,
        alternate_nullifier: [u8; 32],
        randomized_spend_key: [u8; 32],
        spend_authorization: [u8; 64],
    ) -> Result<Self, ClaimProofError> {
        let public_inputs = spec
            .circuit_public_inputs(alternate_nullifier, randomized_spend_key)
            .map_err(ClaimProofError::InvalidClaim)?;
        let message = spec
            .spend_authorization_message(alternate_nullifier)
            .map_err(ClaimProofError::InvalidClaim)?;
        crate::verify_spend_authorization(randomized_spend_key, &message, spend_authorization)
            .map_err(|_| ClaimProofError::InvalidSpendAuthSignature)?;

        let (params, pk) = claim_proving_key()?;
        let mut transcript = Blake2bWrite::<_, vesta::Affine, Challenge255<_>>::init(vec![]);
        create_proof(
            params,
            pk,
            &[circuit.clone()],
            &[&[&public_inputs]],
            OsRng,
            &mut transcript,
        )
        .map_err(|_| ClaimProofError::ProofCreationFailed)?;

        let fields = public_inputs.map(|field| field.to_repr());
        Ok(Self {
            public_inputs: fields,
            randomized_spend_key,
            spend_authorization,
            proof: transcript.finalize(),
        })
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, ClaimProofError> {
        if self.proof.is_empty() || self.proof.len() > MAX_CLAIM_PROOF_BYTES {
            return Err(ClaimProofError::ProofTooLarge);
        }
        let proof_len =
            u32::try_from(self.proof.len()).map_err(|_| ClaimProofError::ProofTooLarge)?;
        let mut bytes = Vec::with_capacity(CLAIM_PROOF_FIXED_BYTES + self.proof.len());
        bytes.extend_from_slice(CLAIM_PROOF_MAGIC);
        bytes.extend_from_slice(&proof_len.to_be_bytes());
        for input in self.public_inputs {
            bytes.extend_from_slice(&input);
        }
        bytes.extend_from_slice(&self.randomized_spend_key);
        bytes.extend_from_slice(&self.spend_authorization);
        bytes.extend_from_slice(&self.proof);
        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ClaimProofError> {
        if bytes.len() < CLAIM_PROOF_MAGIC.len() {
            return Err(ClaimProofError::InvalidEncoding);
        }
        if &bytes[..3] == b"HCP" && bytes[3] != b'1' {
            return Err(ClaimProofError::UnsupportedVersion);
        }
        if bytes.len() < CLAIM_PROOF_FIXED_BYTES || &bytes[..4] != CLAIM_PROOF_MAGIC {
            return Err(ClaimProofError::InvalidEncoding);
        }
        let proof_len = u32::from_be_bytes(
            bytes[4..8]
                .try_into()
                .map_err(|_| ClaimProofError::InvalidEncoding)?,
        ) as usize;
        if proof_len == 0 || proof_len > MAX_CLAIM_PROOF_BYTES {
            return Err(ClaimProofError::ProofTooLarge);
        }
        if bytes.len() != CLAIM_PROOF_FIXED_BYTES + proof_len {
            return Err(ClaimProofError::InvalidEncoding);
        }
        let mut public_inputs = [[0; 32]; 9];
        for (index, input) in public_inputs.iter_mut().enumerate() {
            let start = 8 + index * 32;
            input.copy_from_slice(&bytes[start..start + 32]);
        }
        let key_start = 8 + 9 * 32;
        let mut randomized_spend_key = [0; 32];
        randomized_spend_key.copy_from_slice(&bytes[key_start..key_start + 32]);
        let signature_start = key_start + 32;
        let mut spend_authorization = [0; 64];
        spend_authorization.copy_from_slice(&bytes[signature_start..signature_start + 64]);
        let proof_start = signature_start + 64;
        Ok(Self {
            public_inputs,
            randomized_spend_key,
            spend_authorization,
            proof: bytes[proof_start..].to_vec(),
        })
    }

    pub fn public_inputs(&self) -> &[[u8; 32]; 9] {
        &self.public_inputs
    }

    pub fn randomized_spend_key(&self) -> &[u8; 32] {
        &self.randomized_spend_key
    }
}

pub struct ClaimVerifier;

impl ClaimVerifier {
    pub fn verify(spec: &ClaimSpec, claim_proof: &ClaimProof) -> Result<(), ClaimProofError> {
        let alternate_nullifier = claim_proof.public_inputs[0];
        let expected_inputs = spec
            .circuit_public_inputs(alternate_nullifier, claim_proof.randomized_spend_key)
            .map_err(ClaimProofError::InvalidClaim)?;
        for (encoded, expected) in claim_proof.public_inputs.iter().zip(expected_inputs) {
            let decoded = Option::<pallas::Base>::from(pallas::Base::from_repr(*encoded))
                .ok_or(ClaimProofError::InvalidEncoding)?;
            if decoded != expected {
                return Err(ClaimProofError::InvalidEncoding);
            }
        }
        let message = spec
            .spend_authorization_message(alternate_nullifier)
            .map_err(ClaimProofError::InvalidClaim)?;
        crate::verify_spend_authorization(
            claim_proof.randomized_spend_key,
            &message,
            claim_proof.spend_authorization,
        )
        .map_err(|_| ClaimProofError::InvalidSpendAuthSignature)?;

        let (params, pk) = claim_proving_key()?;
        let public_inputs = expected_inputs;
        let mut transcript =
            Blake2bRead::<_, vesta::Affine, Challenge255<_>>::init(&claim_proof.proof[..]);
        verify_proof(
            params,
            pk.get_vk(),
            SingleVerifier::new(params),
            &[&[&public_inputs]],
            &mut transcript,
        )
        .map_err(|_| ClaimProofError::ProofVerificationFailed)
    }
}
