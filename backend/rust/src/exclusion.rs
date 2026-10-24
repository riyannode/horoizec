use core::cmp::Ordering;

use ff::{Field, PrimeField};
use halo2_poseidon::{ConstantLength, Hash, P128Pow5T3};
use pasta_curves::pallas;

pub const EXCLUSION_TREE_DEPTH: usize = 29;
const SENTINEL_COUNT: u64 = 16;
const SENTINEL_EXPONENT: u32 = 250;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExclusionError {
    InvalidNullifier,
    InvalidWitness,
    TooManyIntervals,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExclusionInterval {
    pub low: [u8; 32],
    pub width: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExclusionWitness {
    pub interval: ExclusionInterval,
    pub position: u32,
    pub auth_path: [[u8; 32]; EXCLUSION_TREE_DEPTH],
}

#[derive(Clone, Debug)]
pub struct ExclusionTree {
    intervals: Vec<ExclusionInterval>,
    levels: Vec<Vec<pallas::Base>>,
    empty_hashes: Vec<pallas::Base>,
}

impl ExclusionTree {
    pub fn from_nullifiers(
        nullifiers: impl IntoIterator<Item = [u8; 32]>,
    ) -> Result<Self, ExclusionError> {
        let mut spent = nullifiers
            .into_iter()
            .map(|bytes| {
                Option::<pallas::Base>::from(pallas::Base::from_repr(bytes))
                    .ok_or(ExclusionError::InvalidNullifier)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let step = pallas::Base::from(2).pow([SENTINEL_EXPONENT.into(), 0, 0, 0]);
        spent.extend((0..=SENTINEL_COUNT).map(|index| step * pallas::Base::from(index)));
        spent.sort_by(compare_fields);
        spent.dedup();

        let mut intervals = Vec::new();
        for pair in spent.windows(2) {
            let low = pair[0] + pallas::Base::one();
            let width = pair[1] - pair[0] - pallas::Base::from(2);
            if pair[1] - pair[0] > pallas::Base::from(1) {
                intervals.push(ExclusionInterval {
                    low: low.to_repr(),
                    width: width.to_repr(),
                });
            }
        }
        if spent.last().copied().unwrap_or_else(pallas::Base::zero) != -pallas::Base::one() {
            let low =
                spent.last().copied().unwrap_or_else(pallas::Base::zero) + pallas::Base::one();
            intervals.push(ExclusionInterval {
                low: low.to_repr(),
                width: (-pallas::Base::one() - low).to_repr(),
            });
        }
        let capacity = 1usize << EXCLUSION_TREE_DEPTH;
        if intervals.is_empty() || intervals.len() > capacity {
            return Err(ExclusionError::TooManyIntervals);
        }

        let empty_leaf = gap_commit(pallas::Base::zero(), pallas::Base::zero());
        let mut empty_hashes = vec![empty_leaf];
        for level in 0..EXCLUSION_TREE_DEPTH {
            let prev = empty_hashes[level];
            empty_hashes.push(node_hash(prev, prev));
        }

        let mut levels = vec![
            intervals
                .iter()
                .map(interval_leaf)
                .collect::<Result<Vec<_>, _>>()?,
        ];
        for level in 0..EXCLUSION_TREE_DEPTH {
            let Some(current) = levels.last() else {
                return Err(ExclusionError::InvalidWitness);
            };
            let mut parent = Vec::with_capacity(current.len().div_ceil(2));
            for pair in current.chunks(2) {
                let right = pair.get(1).copied().unwrap_or(empty_hashes[level]);
                parent.push(node_hash(pair[0], right));
            }
            levels.push(parent);
        }

        Ok(Self {
            intervals,
            levels,
            empty_hashes,
        })
    }

    pub fn root(&self) -> [u8; 32] {
        self.levels[EXCLUSION_TREE_DEPTH][0].to_repr()
    }

    pub fn intervals(&self) -> &[ExclusionInterval] {
        &self.intervals
    }

    pub fn witness(&self, nullifier: [u8; 32]) -> Result<ExclusionWitness, ExclusionError> {
        let nullifier = Option::<pallas::Base>::from(pallas::Base::from_repr(nullifier))
            .ok_or(ExclusionError::InvalidNullifier)?;
        let position = self
            .intervals
            .iter()
            .position(|interval| interval_contains(interval, nullifier))
            .ok_or(ExclusionError::InvalidWitness)?;
        let mut index = position;
        let mut auth_path = [[0; 32]; EXCLUSION_TREE_DEPTH];
        for (level, path_element) in auth_path.iter_mut().enumerate() {
            *path_element = self.levels[level]
                .get(index ^ 1)
                .copied()
                .unwrap_or(self.empty_hashes[level])
                .to_repr();
            index >>= 1;
        }
        Ok(ExclusionWitness {
            interval: self.intervals[position].clone(),
            position: position as u32,
            auth_path,
        })
    }

    pub fn verify_witness(
        &self,
        nullifier: [u8; 32],
        witness: &ExclusionWitness,
    ) -> Result<(), ExclusionError> {
        verify_exclusion_witness(self.root(), nullifier, witness)
    }
}

pub fn verify_exclusion_witness(
    root: [u8; 32],
    nullifier: [u8; 32],
    witness: &ExclusionWitness,
) -> Result<(), ExclusionError> {
    if witness.position as usize >= 1usize << EXCLUSION_TREE_DEPTH {
        return Err(ExclusionError::InvalidWitness);
    }
    let nullifier = Option::<pallas::Base>::from(pallas::Base::from_repr(nullifier))
        .ok_or(ExclusionError::InvalidNullifier)?;
    if !interval_contains(&witness.interval, nullifier) {
        return Err(ExclusionError::InvalidWitness);
    }
    let mut hash = interval_leaf(&witness.interval)?;
    for (level, sibling_bytes) in witness.auth_path.iter().enumerate() {
        let sibling = Option::<pallas::Base>::from(pallas::Base::from_repr(*sibling_bytes))
            .ok_or(ExclusionError::InvalidWitness)?;
        hash = if (witness.position >> level) & 1 == 0 {
            node_hash(hash, sibling)
        } else {
            node_hash(sibling, hash)
        };
    }
    if hash.to_repr() != root {
        return Err(ExclusionError::InvalidWitness);
    }
    Ok(())
}

fn compare_fields(left: &pallas::Base, right: &pallas::Base) -> Ordering {
    left.to_repr()
        .iter()
        .rev()
        .cmp(right.to_repr().iter().rev())
}

fn interval_contains(interval: &ExclusionInterval, value: pallas::Base) -> bool {
    let (Some(low), Some(width)) = (
        Option::<pallas::Base>::from(pallas::Base::from_repr(interval.low)),
        Option::<pallas::Base>::from(pallas::Base::from_repr(interval.width)),
    ) else {
        return false;
    };
    let offset = value - low;
    let limit = pallas::Base::from(2).pow([SENTINEL_EXPONENT.into(), 0, 0, 0]);
    compare_fields(&offset, &limit) == Ordering::Less
        && compare_fields(&offset, &width) != Ordering::Greater
        && compare_fields(&(limit - pallas::Base::one() - width + offset), &limit) == Ordering::Less
}

fn interval_leaf(interval: &ExclusionInterval) -> Result<pallas::Base, ExclusionError> {
    let low = Option::<pallas::Base>::from(pallas::Base::from_repr(interval.low))
        .ok_or(ExclusionError::InvalidWitness)?;
    if bool::from(low.is_zero()) {
        return Err(ExclusionError::InvalidWitness);
    }
    let width = Option::<pallas::Base>::from(pallas::Base::from_repr(interval.width))
        .ok_or(ExclusionError::InvalidWitness)?;
    let limit = pallas::Base::from(2).pow([SENTINEL_EXPONENT.into(), 0, 0, 0]);
    let remaining = -pallas::Base::one() - low;
    if compare_fields(&width, &limit) != Ordering::Less
        || compare_fields(&width, &remaining) == Ordering::Greater
    {
        return Err(ExclusionError::InvalidWitness);
    }
    Ok(gap_commit(low, width))
}

fn gap_commit(low: pallas::Base, width: pallas::Base) -> pallas::Base {
    Hash::<_, P128Pow5T3, ConstantLength<2>, 3, 2>::init().hash([low, width])
}

fn node_hash(left: pallas::Base, right: pallas::Base) -> pallas::Base {
    Hash::<_, P128Pow5T3, ConstantLength<2>, 3, 2>::init().hash([left, right])
}
