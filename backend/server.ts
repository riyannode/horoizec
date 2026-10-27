import { Hono, type Context, type Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { config } from "./config";
import { consumeNullifier, createIsolatedNullifierStore, getClaim, listClaims, saveClaim } from "./db";
import { createClaimSchema, verifySchema } from "./schema";
import { deriveClaim, validateAssetId, verifyProof } from "./proof";
import { getPublicActionBlocks, resolveSnapshot } from "./zcash";
import { getDemoClaim, getDemoFixtureNullifier, getDemoOverview, getDemoProofBundle, initializeDemoFixture, isDemoClaim, pinnedDemoStatementMatches, verifyDemoProof } from "./demo";
import { z } from "zod";

type Variables = { requestId: string };
const app = new Hono<{ Variables: Variables }>();
const ROUTE_DEADLINE_MS = 14 * 60_000;
async function withRouteDeadline<T>(c: Context<{ Variables: Variables }>, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const requestSignal = c.req.raw.signal;
  const abortRequest = () => controller.abort();
  const deadline = setTimeout(abortRequest, ROUTE_DEADLINE_MS);
  requestSignal.addEventListener("abort", abortRequest, { once: true });
  if (requestSignal.aborted) controller.abort();
  try {
    if (controller.signal.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
    return await operation(controller.signal);
  } finally {
    controller.abort();
    clearTimeout(deadline);
    requestSignal.removeEventListener("abort", abortRequest);
  }
}
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
  DEMO_READ_ONLY: "Docker demo mode exposes only its pinned claim fixture.",
  DEMO_FIXTURE_INVALID: "The pinned HCP1 fixture failed native verification.",
  DEMO_TAMPER_CHECK_FAILED: "The native verifier did not reject the tampered fixture as expected.",
  DEMO_REPLAY_CHECK_FAILED: "The isolated SQLite replay fixture did not reject its duplicate nullifier.",
  NETWORK_MISMATCH: "The configured node is not the selected testnet or regtest network.",
  ZSA_UNSUPPORTED: "The configured chain has not activated OrchardZSA support.",
  RATE_LIMITED: "The verifier is busy. Try again shortly.",
  INTERNAL_ERROR: "An internal error occurred."
};
app.use("*", cors({ origin: ["http://localhost:3000", "http://127.0.0.1:3000"], allowMethods: ["GET", "POST"], allowHeaders: ["content-type"] }));
app.use("/api/v1/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
app.use("/api/v1/demo/*", bodyLimit({ maxSize: 16 * 1024 }));
app.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId", requestId);
  const start = performance.now();
  await next();
  console.info(JSON.stringify({ requestId, route: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - start) }));
});
app.onError((error, c) => {
  const code = Object.hasOwn(messages, error.message) ? error.message : "INTERNAL_ERROR";
  const status = code === "RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : code === "CLAIM_NOT_FOUND" ? 404 : code === "NULLIFIER_USED" || code === "SNAPSHOT_STALE" ? 409 : code === "CLAIM_EXPIRED" ? 410 : code === "MAINNET_DISABLED" || code === "DEMO_READ_ONLY" ? 403 : code.endsWith("_UNAVAILABLE") || code === "DEMO_FIXTURE_INVALID" || code === "DEMO_TAMPER_CHECK_FAILED" || code === "DEMO_REPLAY_CHECK_FAILED" ? 503 : 400;
  const response = c.json({ error: { code, message: messages[code] ?? messages.BAD_REQUEST, requestId: c.get("requestId") } }, status);
  if (code === "RATE_LIMITED") response.headers.set("Retry-After", "2");
  return response;
});

app.get("/api/v1/health", (c) => c.json({ ok: true, version: "1.0.0", network: config.NETWORK_ID }));
const CRYPTO_WINDOW_MS = 60_000;
const GLOBAL_CRYPTO_LIMIT = 48;
const CLIENT_CRYPTO_LIMIT = 8;
const MAX_CLIENT_BUCKETS = 256;
const MAX_CONCURRENT_VERIFICATIONS = 2;
type ClientBucket = { windowStartedAt: number; requests: number; active: number };
let cryptoWindowStartedAt = Date.now();
let cryptoRequests = 0;
let activeVerifications = 0;
const clientBuckets = new Map<string, ClientBucket>();
async function limitCrypto(c: Context<{ Variables: Variables }>, next: Next) {
  const now = Date.now();
  if (now - cryptoWindowStartedAt >= CRYPTO_WINDOW_MS) {
    cryptoWindowStartedAt = now;
    cryptoRequests = 0;
  }
  const cost = c.req.path.endsWith("/submit") ? 2 : 1;
  const proxyAddress = config.HOROI_TRUST_PROXY_CLIENT_IP ? c.req.header("x-horoi-client-ip") : undefined;
  const clientAddress = proxyAddress && isIP(proxyAddress) ? proxyAddress : undefined;
  for (const [address, bucket] of clientBuckets) {
    if (!bucket.active && now - bucket.windowStartedAt >= CRYPTO_WINDOW_MS) clientBuckets.delete(address);
  }
  const reject = (retryAfterMs: number) => c.json({
    error: { code: "RATE_LIMITED", message: "The verifier is busy. Try again shortly.", requestId: c.get("requestId") },
  }, 429, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) });
  if (cryptoRequests + cost > GLOBAL_CRYPTO_LIMIT) return reject(CRYPTO_WINDOW_MS - (now - cryptoWindowStartedAt));
  if (config.HOROI_DEMO_MODE && activeVerifications >= MAX_CONCURRENT_VERIFICATIONS) return reject(2_000);

  let clientBucket: ClientBucket | undefined;
  if (clientAddress) {
    clientBucket = clientBuckets.get(clientAddress);
    if (!clientBucket) {
      if (clientBuckets.size >= MAX_CLIENT_BUCKETS) return reject(CRYPTO_WINDOW_MS);
      clientBucket = { windowStartedAt: now, requests: 0, active: 0 };
      clientBuckets.set(clientAddress, clientBucket);
    } else if (now - clientBucket.windowStartedAt >= CRYPTO_WINDOW_MS) {
      clientBucket.windowStartedAt = now;
      clientBucket.requests = 0;
    }
    if (clientBucket.active >= 1) return reject(2_000);
    if (clientBucket.requests + cost > CLIENT_CRYPTO_LIMIT) {
      return reject(CRYPTO_WINDOW_MS - (now - clientBucket.windowStartedAt));
    }
  }

  cryptoRequests += cost;
  if (config.HOROI_DEMO_MODE) activeVerifications++;
  if (clientBucket) {
    clientBucket.requests += cost;
    clientBucket.active++;
  }
  try {
    await next();
  } finally {
    if (config.HOROI_DEMO_MODE) activeVerifications--;
    if (clientBucket) clientBucket.active--;
  }
}
app.use("/api/v1/claims", async (c, next) => {
  if (!config.HOROI_DEMO_MODE && c.req.method === "POST" && c.req.path === "/api/v1/claims") return limitCrypto(c, next);
  return next();
});
app.use("/api/v1/proofs/verify", limitCrypto);
app.use("/api/v1/claims/:id/submit", limitCrypto);
app.use("/api/v1/demo/verify", limitCrypto);
app.use("/api/v1/demo/submit", limitCrypto);
const ACTION_WINDOW_MS = 60_000;
const GLOBAL_ACTION_RANGE_LIMIT = 600;
const CLIENT_ACTION_RANGE_LIMIT = 120;
let actionWindowStartedAt = Date.now();
let actionRangeRequests = 0;
const actionClientBuckets = new Map<string, ClientBucket>();

async function limitActionRanges(c: Context<{ Variables: Variables }>, next: Next) {
  if (config.HOROI_DEMO_MODE) return next();
  const now = Date.now();
  if (now - actionWindowStartedAt >= ACTION_WINDOW_MS) {
    actionWindowStartedAt = now;
    actionRangeRequests = 0;
  }
  const proxyAddress = config.HOROI_TRUST_PROXY_CLIENT_IP ? c.req.header("x-horoi-client-ip") : undefined;
  const clientAddress = proxyAddress && isIP(proxyAddress) ? proxyAddress : undefined;
  const reject = (retryAfterMs: number) => c.json({
    error: { code: "RATE_LIMITED", message: messages.RATE_LIMITED, requestId: c.get("requestId") },
  }, 429, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) });
  if (actionRangeRequests >= GLOBAL_ACTION_RANGE_LIMIT) return reject(ACTION_WINDOW_MS - (now - actionWindowStartedAt));

  let clientBucket: ClientBucket | undefined;
  if (clientAddress) {
    for (const [address, bucket] of actionClientBuckets) {
      if (!bucket.active && now - bucket.windowStartedAt >= ACTION_WINDOW_MS) actionClientBuckets.delete(address);
    }
    clientBucket = actionClientBuckets.get(clientAddress);
    if (!clientBucket) {
      if (actionClientBuckets.size >= MAX_CLIENT_BUCKETS) return reject(ACTION_WINDOW_MS);
      clientBucket = { windowStartedAt: now, requests: 0, active: 0 };
      actionClientBuckets.set(clientAddress, clientBucket);
    } else if (now - clientBucket.windowStartedAt >= ACTION_WINDOW_MS) {
      clientBucket.windowStartedAt = now;
      clientBucket.requests = 0;
    }
    if (clientBucket.requests >= CLIENT_ACTION_RANGE_LIMIT) {
      return reject(ACTION_WINDOW_MS - (now - clientBucket.windowStartedAt));
    }
    clientBucket.requests++;
  }
  actionRangeRequests++;
  await next();
}

const SNAPSHOT_CREATION_WINDOW_MS = 15 * 60_000;
const GLOBAL_SNAPSHOT_CREATION_LIMIT = 4;
const CLIENT_SNAPSHOT_CREATION_LIMIT = 1;
let snapshotCreationWindowStartedAt = Date.now();
let snapshotCreations = 0;
const snapshotCreationClients = new Map<string, ClientBucket>();

function admitSnapshotCreation(c: Context<{ Variables: Variables }>): Response | undefined {
  const now = Date.now();
  if (now - snapshotCreationWindowStartedAt >= SNAPSHOT_CREATION_WINDOW_MS) {
    snapshotCreationWindowStartedAt = now;
    snapshotCreations = 0;
  }
  const proxyAddress = config.HOROI_TRUST_PROXY_CLIENT_IP ? c.req.header("x-horoi-client-ip") : undefined;
  const clientAddress = proxyAddress && isIP(proxyAddress) ? proxyAddress : undefined;
  const reject = (retryAfterMs: number) => c.json({
    error: { code: "RATE_LIMITED", message: messages.RATE_LIMITED, requestId: c.get("requestId") },
  }, 429, { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) });
  if (snapshotCreations >= GLOBAL_SNAPSHOT_CREATION_LIMIT) {
    return reject(SNAPSHOT_CREATION_WINDOW_MS - (now - snapshotCreationWindowStartedAt));
  }
  let bucket: ClientBucket | undefined;
  if (clientAddress) {
    for (const [address, entry] of snapshotCreationClients) {
      if (!entry.active && now - entry.windowStartedAt >= SNAPSHOT_CREATION_WINDOW_MS) snapshotCreationClients.delete(address);
    }
    bucket = snapshotCreationClients.get(clientAddress);
    if (!bucket) {
      if (snapshotCreationClients.size >= MAX_CLIENT_BUCKETS) return reject(SNAPSHOT_CREATION_WINDOW_MS);
      bucket = { windowStartedAt: now, requests: 0, active: 0 };
      snapshotCreationClients.set(clientAddress, bucket);
    } else if (now - bucket.windowStartedAt >= SNAPSHOT_CREATION_WINDOW_MS) {
      bucket.windowStartedAt = now;
      bucket.requests = 0;
    }
    if (bucket.requests >= CLIENT_SNAPSHOT_CREATION_LIMIT) {
      return reject(SNAPSHOT_CREATION_WINDOW_MS - (now - bucket.windowStartedAt));
    }
  }
  snapshotCreations++;
  if (bucket) bucket.requests++;
  return undefined;
}

app.use("/api/v1/snapshots/*", limitActionRanges);

async function assertActiveSnapshot(claim: NonNullable<ReturnType<typeof getClaim>>, signal?: AbortSignal) {
  if (config.HOROI_DEMO_MODE) {
    if (!pinnedDemoStatementMatches(claim)) throw new Error("SNAPSHOT_STALE");
    return;
  }
  if (claim.networkId !== config.NETWORK_ID) throw new Error("SNAPSHOT_STALE");
  const snapshot = await resolveSnapshot(claim.snapshotHeight, signal);
  if (snapshot.commitmentRoot.toLowerCase() !== claim.commitmentRoot.toLowerCase() || snapshot.exclusionRoot.toLowerCase() !== claim.exclusionRoot.toLowerCase()) {
    throw new Error("SNAPSHOT_STALE");
  }
}
async function acceptProof(
  claim: NonNullable<ReturnType<typeof getClaim>>,
  input: ReturnType<typeof verifySchema.parse>,
  consume = consumeNullifier,
  signal?: AbortSignal,
) {
  const result = await verifyProof({
    networkId: claim.networkId, assetId: claim.assetId, threshold: claim.threshold,
    snapshotHeight: claim.snapshotHeight, commitmentRoot: claim.commitmentRoot,
    exclusionRoot: claim.exclusionRoot, expiresAt: claim.expiresAt, creatorNonce: claim.creatorNonce
  }, Buffer.from(input.proof, "base64").toString("hex"), signal);
  if (!result.valid) throw new Error("PROOF_INVALID");
  const submittedNullifier = input.alternateNullifiers[0];
  if (!result.alternateNullifier || !submittedNullifier || submittedNullifier.toLowerCase() !== result.alternateNullifier) {
    throw new Error("PROOF_INPUT_MISMATCH");
  }
  await assertActiveSnapshot(claim, signal);
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  if (!consume(claim.id, result.alternateNullifier)) throw new Error("NULLIFIER_USED");
  return result.alternateNullifier;
}
async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("BAD_REQUEST");
    throw error;
  }
}
app.get("/api/v1/claims", (c) => {
  const parsed = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed))) : 20;
  const status = c.req.query("status");
  if (status !== undefined && status !== "active" && status !== "expired") throw new Error("BAD_REQUEST");
  const claims = listClaims(limit, c.req.query("cursor"), status);
  return c.json({ claims: config.HOROI_DEMO_MODE ? claims.filter((claim) => isDemoClaim(claim.id)) : claims });
});
app.get("/api/v1/snapshots/:height/actions", async (c) => {
  if (config.HOROI_DEMO_MODE) throw new Error("DEMO_READ_ONLY");
  const snapshotHeight = Number(c.req.param("height"));
  const start = Number(c.req.query("start"));
  const end = Number(c.req.query("end"));
  if (![snapshotHeight, start, end].every(Number.isSafeInteger)) throw new Error("INVALID_SNAPSHOT");
  return await withRouteDeadline(c, async (signal) => c.json({ blocks: await getPublicActionBlocks(snapshotHeight, start, end, signal) }));
});
app.get("/api/v1/claims/:id", (c) => {
  const claim = getClaim(c.req.param("id"));
  if (!claim || (config.HOROI_DEMO_MODE && !isDemoClaim(claim.id))) throw new Error("CLAIM_NOT_FOUND");
  return c.json({ claim });
});
app.post("/api/v1/claims", async (c) => {
  if (config.HOROI_DEMO_MODE) throw new Error("DEMO_READ_ONLY");
  const parsed = createClaimSchema.safeParse(await parseJsonBody(c));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new Error(field === "assetId" ? "INVALID_ASSET_ID" : field === "threshold" ? "INVALID_THRESHOLD" : field === "snapshotHeight" ? "INVALID_SNAPSHOT" : "BAD_REQUEST");
  }
  const input = parsed.data;
  return await withRouteDeadline(c, async (signal) => {
    await validateAssetId(input.assetId, signal);
    const admission = admitSnapshotCreation(c);
    if (admission) return admission;
    const snapshot = await resolveSnapshot(input.snapshotHeight, signal);
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
    const derived = await deriveClaim(statement, signal);
    const claim = saveClaim(input, {
      id: derived.claimId!, networkId: config.NETWORK_ID, commitmentRoot: statement.commitmentRoot,
      exclusionRoot: statement.exclusionRoot, claimDomain: derived.claimDomain!, creatorNonce: statement.creatorNonce
    }, Math.floor(Date.now() / 1000));
    return c.json({ claim }, 201);
  });
});
app.post("/api/v1/proofs/verify", async (c) => {
  const parsed = verifySchema.safeParse(await parseJsonBody(c));
  if (!parsed.success) throw new Error("BAD_REQUEST");
  const input = parsed.data;
  const claim = getClaim(input.claimId);
  if (!claim || (config.HOROI_DEMO_MODE && !isDemoClaim(claim.id))) throw new Error("CLAIM_NOT_FOUND");
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  return await withRouteDeadline(c, async (signal) => {
    const result = await verifyProof({
      networkId: claim.networkId, assetId: claim.assetId, threshold: claim.threshold,
      snapshotHeight: claim.snapshotHeight, commitmentRoot: claim.commitmentRoot,
      exclusionRoot: claim.exclusionRoot, expiresAt: claim.expiresAt, creatorNonce: claim.creatorNonce
    }, Buffer.from(input.proof, "base64").toString("hex"), signal);
    if (!result.valid) return c.json({ valid: false, claimId: claim.id });
    const submittedNullifier = input.alternateNullifiers[0];
    if (!result.alternateNullifier || !submittedNullifier || submittedNullifier.toLowerCase() !== result.alternateNullifier) {
      throw new Error("PROOF_INPUT_MISMATCH");
    }
    await assertActiveSnapshot(claim, signal);
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
});
app.post("/api/v1/claims/:id/submit", async (c) => {
  const claim = getClaim(c.req.param("id"));
  if (!claim || (config.HOROI_DEMO_MODE && !isDemoClaim(claim.id))) throw new Error("CLAIM_NOT_FOUND");
  if (claim.expiresAt !== null && claim.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("CLAIM_EXPIRED");
  const parsed = verifySchema.safeParse(await parseJsonBody(c));
  if (!parsed.success) throw new Error("BAD_REQUEST");
  if (parsed.data.claimId !== claim.id || parsed.data.protocolVersion !== claim.protocolVersion) throw new Error("PROOF_INPUT_MISMATCH");
  return await withRouteDeadline(c, async (signal) => {
    await acceptProof(claim, parsed.data, consumeNullifier, signal);
    return c.json({ accepted: true, replayProtection: "note-level" });
  });
});

app.get("/api/v1/demo/fixture", (c) => {
  if (!config.HOROI_DEMO_MODE) return c.notFound();
  return c.json(getDemoOverview());
});
app.post("/api/v1/demo/verify", async (c) => {
  if (!config.HOROI_DEMO_MODE) return c.notFound();
  const body = z.object({ scenario: z.enum(["valid", "tampered"]) }).strict().safeParse(await parseJsonBody(c));
  if (!body.success) throw new Error("BAD_REQUEST");
  return c.json(await verifyDemoProof(body.data.scenario === "tampered"));
});
app.post("/api/v1/demo/submit", async (c) => {
  if (!config.HOROI_DEMO_MODE) return c.notFound();
  const body = z.object({ fixtureId: z.literal("judge-hcp1") }).strict().safeParse(await parseJsonBody(c));
  if (!body.success) throw new Error("BAD_REQUEST");
  const claim = getDemoClaim();
  const input = verifySchema.parse({
    claimId: claim.id,
    protocolVersion: 1,
    proof: getDemoProofBundle(),
    alternateNullifiers: [getDemoFixtureNullifier()],
  });
  const isolatedStore = createIsolatedNullifierStore(claim);
  try {
    const acceptedNullifier = await acceptProof(claim, input, isolatedStore.consume);
    try {
      await acceptProof(claim, input, isolatedStore.consume);
      throw new Error("DEMO_REPLAY_CHECK_FAILED");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "NULLIFIER_USED") throw error;
    }
    return c.json({
      firstSubmission: { accepted: true },
      replay: { accepted: false, errorCode: "NULLIFIER_USED" },
      replayProtection: "note-level",
      state: "isolated-sqlite-per-run",
      alternateNullifier: acceptedNullifier,
    });
  } finally {
    isolatedStore.close();
  }
});

await initializeDemoFixture();
export default { hostname: config.HOST, port: config.PORT, fetch: app.fetch };
