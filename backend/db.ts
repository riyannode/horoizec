import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { config } from "./config";
import type { CreateClaimInput } from "./schema";
export interface ClaimRecord {
  id: string; protocolVersion: number; networkId: string; name: string; description: string;
  assetId: string; threshold: string; snapshotHeight: number; commitmentRoot: string;
  exclusionRoot: string; claimDomain: string; creatorNonce: string; expiresAt: number | null; createdAt: number;
  status: "active" | "expired";
}
export const db = new Database(config.DATABASE_PATH, { create: true });
db.exec("PRAGMA foreign_keys = ON");
db.exec(readFileSync(new URL("./migrations/001_init.sql", import.meta.url), "utf8"));
const columns = `id, protocol_version AS protocolVersion, network_id AS networkId, name, description,
  asset_id AS assetId, threshold, snapshot_height AS snapshotHeight, commitment_root AS commitmentRoot,
  exclusion_root AS exclusionRoot, claim_domain AS claimDomain, creator_nonce AS creatorNonce,
  expires_at AS expiresAt, created_at AS createdAt,
  CASE WHEN expires_at IS NOT NULL AND expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
    THEN 'expired' ELSE 'active' END AS status`;
export function listClaims(limit: number, cursor?: string): ClaimRecord[] {
  const rows = cursor
    ? db.query(`SELECT ${columns} FROM claims WHERE id < ? ORDER BY id DESC LIMIT ?`).all(cursor, limit)
    : db.query(`SELECT ${columns} FROM claims ORDER BY id DESC LIMIT ?`).all(limit);
  return rows as ClaimRecord[];
}
export function getClaim(id: string): ClaimRecord | null {
  return db.query(`SELECT ${columns} FROM claims WHERE id = ?`).get(id) as ClaimRecord | null;
}
export function saveClaim(input: CreateClaimInput, s: {
  id: string; networkId: string; commitmentRoot: string; exclusionRoot: string; claimDomain: string; creatorNonce: string
}, createdAt: number): ClaimRecord {
  db.query(`INSERT INTO claims
    (id, protocol_version, network_id, name, description, asset_id, threshold, snapshot_height,
     commitment_root, exclusion_root, claim_domain, creator_nonce, expires_at, created_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      s.id, s.networkId, input.name, input.description, input.assetId.toLowerCase(), input.threshold,
      input.snapshotHeight, s.commitmentRoot, s.exclusionRoot, s.claimDomain, s.creatorNonce, input.expiresAt, createdAt
    );
  const saved = getClaim(s.id);
  if (!saved) throw new Error("CLAIM_INSERT_FAILED");
  return saved;
}

export function consumeNullifier(claimId: string, nullifier: string): boolean {
  const result = db.query(`INSERT OR IGNORE INTO nullifiers (claim_id, nullifier, created_at) VALUES (?, ?, ?)`).run(
    claimId,
    nullifier,
    Math.floor(Date.now() / 1000),
  );
  return result.changes === 1;
}
