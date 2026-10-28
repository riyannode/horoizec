import { readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "./config";
import { ensureDemoClaim, getClaim, type ClaimRecord } from "./db";
import { deriveClaim, verifyProof } from "./proof";

const hex = /^[0-9a-f]{64}$/;
const fixtureSchema = z.object({
  networkId: z.literal("zebra-regtest"),
  assetId: z.string().regex(/^(?:[0-9a-f]{2}){66}$/),
  threshold: z.string().regex(/^[1-9][0-9]*$/),
  snapshotHeight: z.number().int().nonnegative().max(4294967295),
  commitmentRoot: z.string().regex(hex),
  exclusionRoot: z.string().regex(hex),
  expiresAt: z.string().regex(/^[1-9][0-9]*$/).nullable(),
  creatorNonce: z.string().regex(hex),
  alternateNullifier: z.string().regex(hex),
  proof: z.string().regex(/^(?:[0-9a-f]{2})+$/).max(2_000_000),
}).strict();

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(new URL("./fixtures/judge-hcp1.json", import.meta.url), "utf8")));
const statement = {
  networkId: fixture.networkId,
  assetId: fixture.assetId,
  threshold: fixture.threshold,
  snapshotHeight: fixture.snapshotHeight,
  commitmentRoot: fixture.commitmentRoot,
  exclusionRoot: fixture.exclusionRoot,
  expiresAt: fixture.expiresAt,
  creatorNonce: fixture.creatorNonce,
};

let demoClaim: ClaimRecord | null = null;

export async function initializeDemoFixture(): Promise<void> {
  if (!config.HOROI_DEMO_MODE) return;
  const derived = await deriveClaim(statement);
  if (!derived.claimId || !derived.claimDomain) throw new Error("DEMO_FIXTURE_INVALID");
  const proof = await verifyProof(statement, fixture.proof);
  if (proof.valid !== true || proof.alternateNullifier !== fixture.alternateNullifier) {
    throw new Error("DEMO_FIXTURE_INVALID");
  }
  demoClaim = ensureDemoClaim({
    id: derived.claimId,
    networkId: fixture.networkId,
    assetId: fixture.assetId,
    threshold: fixture.threshold,
    snapshotHeight: fixture.snapshotHeight,
    commitmentRoot: fixture.commitmentRoot,
    exclusionRoot: fixture.exclusionRoot,
    claimDomain: derived.claimDomain,
    creatorNonce: fixture.creatorNonce,
    expiresAt: fixture.expiresAt === null ? null : Number(fixture.expiresAt),
  });
}

export function getDemoClaim(): ClaimRecord {
  if (!demoClaim) throw new Error("DEMO_FIXTURE_INVALID");
  return demoClaim;
}

export function isDemoClaim(claimId: string): boolean {
  return config.HOROI_DEMO_MODE && demoClaim?.id === claimId;
}

export function getDemoOverview() {
  const claim = getDemoClaim();
  return {
    fixtureId: "judge-hcp1",
    provenance: "LOCAL SYNTHETIC TEST FIXTURE",
    networkId: claim.networkId,
    claimId: claim.id,
    protocolVersion: claim.protocolVersion,
    assetId: claim.assetId,
    threshold: claim.threshold,
    snapshotHeight: claim.snapshotHeight,
    commitmentRoot: claim.commitmentRoot,
    exclusionRoot: claim.exclusionRoot,
    expiresAt: claim.expiresAt,
    alternateNullifier: fixture.alternateNullifier,
  };
}

export async function verifyDemoProof(tampered = false) {
  const proof = Buffer.from(fixture.proof, "hex");
  if (tampered) {
    const byte = proof.at(392);
    if (byte === undefined) throw new Error("DEMO_FIXTURE_INVALID");
    proof.set([byte ^ 1], 392);
  }
  const result = await verifyProof(statement, proof.toString("hex"));
  if (tampered) {
    if (result.valid === true || result.errorCode !== "INVALID_PROOF") throw new Error("DEMO_TAMPER_CHECK_FAILED");
    return { valid: false as const, verifier: "horoi-verifier", verifierErrorCode: result.errorCode };
  }
  if (result.valid !== true || result.alternateNullifier !== fixture.alternateNullifier) {
    throw new Error("DEMO_FIXTURE_INVALID");
  }
  return { valid: true as const, verifier: "horoi-verifier", alternateNullifier: fixture.alternateNullifier };
}

export function getDemoProofBundle(): string {
  return Buffer.from(fixture.proof, "hex").toString("base64");
}

export function getDemoFixtureNullifier(): string {
  return fixture.alternateNullifier;
}

export function pinnedDemoStatementMatches(claim: ClaimRecord): boolean {
  return isDemoClaim(claim.id)
    && claim.networkId === fixture.networkId
    && claim.assetId === fixture.assetId
    && claim.threshold === fixture.threshold
    && claim.snapshotHeight === fixture.snapshotHeight
    && claim.commitmentRoot === fixture.commitmentRoot
    && claim.exclusionRoot === fixture.exclusionRoot
    && claim.creatorNonce === fixture.creatorNonce
    && claim.expiresAt === (fixture.expiresAt === null ? null : Number(fixture.expiresAt));
}
