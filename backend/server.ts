import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { consumeNullifier, getClaim, listClaims, saveClaim } from "./db";
import { createClaimSchema, verifySchema } from "./schema";
import { deriveClaim, validateAssetId, verifyProof } from "./proof";
import { getPublicActionBlocks, resolveSnapshot } from "./zcash";

type Variables = { requestId: string };
const app = new Hono<{ Variables: Variables }>();
const messages: Record<string, string> = {
  BAD_REQUEST: "The request is invalid.",
  CLAIM_NOT_FOUND: "The claim was not found.",
  CLAIM_EXPIRED: "The claim has expired.",
  PROOF_INVALID: "The proof could not be verified.",
  PROOF_INPUT_MISMATCH: "The proof does not match this claim.",
  SNAPSHOT_UNAVAILABLE: "The requested snapshot is unavailable.",
  ZCASH_RPC_UNAVAILABLE: "The configured Zcash node is unavailable.",
  SNAPSHOT_STALE: "The claim snapshot no longer matches the active chain.",
  NULLIFIER_USED: "These notes have already been used in this claim.",
  VERIFIER_UNAVAILABLE: "The local Rust verifier is unavailable.",
  INVALID_ASSET_ID: "The AssetId is invalid.",
  INVALID_THRESHOLD: "The threshold must be a positive integer.",
  INVALID_SNAPSHOT: "The snapshot height is invalid.",
  MAINNET_DISABLED: "Mainnet is disabled for this prototype.",
  NETWORK_MISMATCH: "The configured node is not the selected testnet or regtest network.",
  ZSA_UNSUPPORTED: "The configured chain has not activated OrchardZSA support."
};
app.use("*", cors({ origin: ["http://localhost:3000", "http://127.0.0.1:3000"], allowMethods: ["GET", "POST"], allowHeaders: ["content-type"] }));
app.use("/api/v1/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
app.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId", requestId);
  const start = performance.now();
  await next();
  console.info(JSON.stringify({ requestId, route: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - start) }));
});
app.onError((error, c) => {
  const code = error.message in messages ? error.message : "BAD_REQUEST";
  const status = code === "CLAIM_NOT_FOUND" ? 404 : code === "NULLIFIER_USED" || code === "SNAPSHOT_STALE" ? 409 : code === "CLAIM_EXPIRED" ? 410 : code === "MAINNET_DISABLED" ? 403 : code.endsWith("_UNAVAILABLE") ? 503 : 400;
  return c.json({ error: { code, message: messages[code] ?? messages.BAD_REQUEST, requestId: c.get("requestId") } }, status);
});

app.get("/api/v1/health", (c) => c.json({ ok: true, version: "1.0.0", network: config.NETWORK_ID }));
async function assertActiveSnapshot(claim: NonNullable<ReturnType<typeof getClaim>>) {
  if (claim.networkId !== config.NETWORK_ID) throw new Error("SNAPSHOT_STALE");
  const snapshot = await resolveSnapshot(claim.snapshotHeight);
  if (snapshot.commitmentRoot.toLowerCase() !== claim.commitmentRoot.toLowerCase() || snapshot.exclusionRoot.toLowerCase() !== claim.exclusionRoot.toLowerCase()) {
    throw new Error("SNAPSHOT_STALE");
  }
}
app.get("/api/v1/claims", (c) => {
  const parsed = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed))) : 20;
  return c.json({ claims: listClaims(limit, c.req.query("cursor")) });
});
app.get("/api/v1/snapshots/:height/actions", async (c) => {
  const snapshotHeight = Number(c.req.param("height"));
  const start = Number(c.req.query("start"));
  const end = Number(c.req.query("end"));
  if (![snapshotHeight, start, end].every(Number.isSafeInteger)) throw new Error("INVALID_SNAPSHOT");
  return c.json({ blocks: await getPublicActionBlocks(snapshotHeight, start, end) });
});
app.get("/api/v1/claims/:id", (c) => {
  const claim = getClaim(c.req.param("id"));
  if (!claim) throw new Error("CLAIM_NOT_FOUND");
  return c.json({ claim });
});
app.post("/api/v1/claims", async (c) => {
  const parsed = createClaimSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new Error(field === "assetId" ? "INVALID_ASSET_ID" : field === "threshold" ? "INVALID_THRESHOLD" : field === "snapshotHeight" ? "INVALID_SNAPSHOT" : "BAD_REQUEST");
  }
  const input = parsed.data;
  await validateAssetId(input.assetId);
  const snapshot = await resolveSnapshot(input.snapshotHeight);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const statement = {
    networkId: config.NETWORK_ID,
    assetId: input.assetId.toLowerCase(),
    threshold: input.threshold,
    snapshotHeight: input.snapshotHeight,
    commitmentRoot: snapshot.commitmentRoot,
    exclusionRoot: snapshot.exclusionRoot,
    expiresAt: input.expiresAt,
    creatorNonce: Array.from(nonce, (v) => v.toString(16).padStart(2, "0")).join("")
  };
  const derived = await deriveClaim(statement);
  const claim = saveClaim(input, {
    id: derived.claimId!, networkId: config.NETWORK_ID, commitmentRoot: statement.commitmentRoot,
    exclusionRoot: statement.exclusionRoot, claimDomain: derived.claimDomain!, creatorNonce: statement.creatorNonce
  }, Math.floor(Date.now() / 1000));
  return c.json({ claim }, 201);
});
app.post("/api/v1/proofs/verify", async (c) => {
  const parsed = verifySchema.safeParse(await c.req.json());
  if (!parsed.success) throw new Error("BAD_REQUEST");
  const input = parsed.data;
  const claim = getClaim(input.claimId);
  if (!claim) throw new Error("CLAIM_NOT_FOUND");
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  const result = await verifyProof({
    networkId: claim.networkId, assetId: claim.assetId, threshold: claim.threshold,
    snapshotHeight: claim.snapshotHeight, commitmentRoot: claim.commitmentRoot,
    exclusionRoot: claim.exclusionRoot, expiresAt: claim.expiresAt, creatorNonce: claim.creatorNonce
  }, Buffer.from(input.proof, "base64").toString("hex"));
  if (!result.valid) return c.json({ valid: false, claimId: claim.id });
  const submittedNullifier = input.alternateNullifiers[0];
  if (!result.alternateNullifier || !submittedNullifier || submittedNullifier.toLowerCase() !== result.alternateNullifier) {
    throw new Error("PROOF_INPUT_MISMATCH");
  }
  await assertActiveSnapshot(claim);
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  return c.json({
    valid: true,
    claimId: claim.id,
    statement: {
      assetId: claim.assetId,
      threshold: claim.threshold,
      snapshotHeight: claim.snapshotHeight,
      protocolVersion: claim.protocolVersion,
    },
    alternateNullifier: result.alternateNullifier,
  });
});
app.post("/api/v1/claims/:id/submit", async (c) => {
  const claim = getClaim(c.req.param("id"));
  if (!claim) throw new Error("CLAIM_NOT_FOUND");
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  const parsed = verifySchema.safeParse(await c.req.json());
  if (!parsed.success) throw new Error("BAD_REQUEST");
  if (parsed.data.claimId !== claim.id || parsed.data.protocolVersion !== claim.protocolVersion) throw new Error("PROOF_INPUT_MISMATCH");
  const result = await verifyProof({
    networkId: claim.networkId, assetId: claim.assetId, threshold: claim.threshold,
    snapshotHeight: claim.snapshotHeight, commitmentRoot: claim.commitmentRoot,
    exclusionRoot: claim.exclusionRoot, expiresAt: claim.expiresAt, creatorNonce: claim.creatorNonce
  }, Buffer.from(parsed.data.proof, "base64").toString("hex"));
  if (!result.valid) throw new Error("PROOF_INVALID");
  const submittedNullifier = parsed.data.alternateNullifiers[0];
  if (!result.alternateNullifier || !submittedNullifier || submittedNullifier.toLowerCase() !== result.alternateNullifier) {
    throw new Error("PROOF_INPUT_MISMATCH");
  }
  await assertActiveSnapshot(claim);
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  if (!consumeNullifier(claim.id, result.alternateNullifier)) throw new Error("NULLIFIER_USED");
  return c.json({ accepted: true, replayProtection: "note-level" });
});
export default { hostname: config.HOST, port: config.PORT, fetch: app.fetch };
