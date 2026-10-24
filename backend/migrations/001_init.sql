CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, protocol_version INTEGER NOT NULL, network_id TEXT NOT NULL,
  name TEXT NOT NULL, description TEXT NOT NULL, asset_id TEXT NOT NULL, threshold TEXT NOT NULL,
  snapshot_height INTEGER NOT NULL, commitment_root TEXT NOT NULL, exclusion_root TEXT NOT NULL,
  claim_domain TEXT NOT NULL UNIQUE, creator_nonce TEXT NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nullifiers (
  claim_id TEXT NOT NULL REFERENCES claims(id), nullifier TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (claim_id, nullifier)
);