import { Database } from "bun:sqlite";
import { chmodSync, readFileSync } from "node:fs";
import { config } from "./config";
import type { CreateClaimInput } from "./schema";
export interface ClaimRecord {
  id: string; protocolVersion: number; networkId: string; name: string; description: string;
  assetId: string; threshold: string; snapshotHeight: number; commitmentRoot: string;
  exclusionRoot: string; claimDomain: string; creatorNonce: string; expiresAt: number | null; createdAt: number;
  status: "active" | "expired";
}
export const db = new Database(config.DATABASE_PATH, { create: true });
if (config.DATABASE_PATH !== ":memory:") chmodSync(config.DATABASE_PATH, 0o640);
db.exec("PRAGMA foreign_keys = ON");
db.exec(readFileSync(new URL("./migrations/001_init.sql", import.meta.url), "utf8"));
const columns = `id, protocol_version AS protocolVersion, network_id AS networkId, name, description,
  asset_id AS assetId, threshold, snapshot_height AS snapshotHeight, commitment_root AS commitmentRoot,
  exclusion_root AS exclusionRoot, claim_domain AS claimDomain, creator_nonce AS creatorNonce,
  expires_at AS expiresAt, created_at AS createdAt,
  CASE WHEN expires_at IS NOT NULL AND expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
    THEN 'expired' ELSE 'active' END AS status`;
export function listClaims(limit: number, cursor?: string, status?: ClaimRecord["status"]): ClaimRecord[] {
  const filters: string[] = [];
  const bindings: Array<string | number> = [];
  if (cursor) {
    filters.push("id < ?");
    bindings.push(cursor);
  }
  if (status) {
    filters.push("CASE WHEN expires_at IS NOT NULL AND expires_at <= CAST(strftime('%s', 'now') AS INTEGER) THEN 'expired' ELSE 'active' END = ?");
    bindings.push(status);
  }
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const rows = db.query(`SELECT ${columns} FROM claims${where} ORDER BY id DESC LIMIT ?`).all(...bindings, limit);
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

export function ensureDemoClaim(s: {
  id: string; networkId: string; assetId: string; threshold: string; snapshotHeight: number;
  commitmentRoot: string; exclusionRoot: string; claimDomain: string; creatorNonce: string; expiresAt: number | null;
}): ClaimRecord {
  const existing = getClaim(s.id);
  if (existing) {
    if (existing.networkId !== s.networkId || existing.assetId !== s.assetId
      || existing.threshold !== s.threshold || existing.snapshotHeight !== s.snapshotHeight
      || existing.commitmentRoot !== s.commitmentRoot || existing.exclusionRoot !== s.exclusionRoot
      || existing.claimDomain !== s.claimDomain || existing.creatorNonce !== s.creatorNonce
      || existing.expiresAt !== s.expiresAt) {
      throw new Error("DEMO_FIXTURE_INVALID");
    }
    return existing;
  }
  return saveClaim({
    name: "Horoi Docker Judge Fixture",
    description: "LOCAL SYNTHETIC TEST FIXTURE; no live chain scan.",
    assetId: s.assetId,
    threshold: s.threshold,
    snapshotHeight: s.snapshotHeight,
    expiresAt: s.expiresAt,
  }, s, 0);
}

export function consumeNullifier(claimId: string, nullifier: string): boolean {
  return consumeNullifierIn(db, claimId, nullifier);
}

function consumeNullifierIn(database: Database, claimId: string, nullifier: string): boolean {
  const result = database.query(`INSERT OR IGNORE INTO nullifiers (claim_id, nullifier, created_at) VALUES (?, ?, ?)`).run(
    claimId,
    nullifier,
    Math.floor(Date.now() / 1000),
  );
  return result.changes === 1;
}

export function createIsolatedNullifierStore(claim: ClaimRecord) {
  const isolated = new Database(":memory:");
  try {
    isolated.exec("PRAGMA foreign_keys = ON");
    isolated.exec(readFileSync(new URL("./migrations/001_init.sql", import.meta.url), "utf8"));
    isolated.query(`INSERT INTO claims
      (id, protocol_version, network_id, name, description, asset_id, threshold, snapshot_height,
       commitment_root, exclusion_root, claim_domain, creator_nonce, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        claim.id, claim.protocolVersion, claim.networkId, claim.name, claim.description, claim.assetId,
        claim.threshold, claim.snapshotHeight, claim.commitmentRoot, claim.exclusionRoot, claim.claimDomain,
        claim.creatorNonce, claim.expiresAt, claim.createdAt,
      );
    return {
      consume: (claimId: string, nullifier: string) => consumeNullifierIn(isolated, claimId, nullifier),
      close: () => isolated.close(),
    };
  } catch (error) {
    isolated.close();
    throw error;
  }
}
