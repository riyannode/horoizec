import { config } from "./config";
import { decodeIssuanceNotes, deriveExclusionRoot } from "./proof";
let rpcId = 0;
const RPC_WINDOW_MS = 15 * 60_000;
const RPC_REQUEST_LIMIT = 80_000;
const MAX_CONCURRENT_RPC_REQUESTS = 16;
let rpcWindowStartedAt = Date.now();
let rpcRequests = 0;
let activeRpcRequests = 0;

type RpcTrace = { requestId?: string; stage: string; snapshotHeight?: number; blockHeight?: number };

function logRpcFailure(trace: RpcTrace | undefined, method: string, attempt: number, durationMs: number, failureCategory: string, upstreamStatus?: number, aborted = false) {
  console.warn(JSON.stringify({
    event: "zcash_rpc_attempt_failed",
    requestId: trace?.requestId,
    stage: trace?.stage,
    method,
    attempt,
    durationMs,
    upstreamStatus,
    failureCategory,
    snapshotHeight: trace?.snapshotHeight,
    blockHeight: trace?.blockHeight,
    aborted,
  }));
}

async function rpc(method: string, params: unknown[] = [], parentSignal?: AbortSignal, trace?: RpcTrace): Promise<unknown> {
  const now = Date.now();
  if (now - rpcWindowStartedAt >= RPC_WINDOW_MS) {
    rpcWindowStartedAt = now;
    rpcRequests = 0;
  }
  const headers = new Headers({ "content-type": "application/json" });
  if (config.ZCASH_RPC_USER && config.ZCASH_RPC_PASSWORD) {
    headers.set("authorization", `Basic ${btoa(`${config.ZCASH_RPC_USER}:${config.ZCASH_RPC_PASSWORD}`)}`);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (parentSignal?.aborted) {
      logRpcFailure(trace, method, attempt + 1, 0, "parent_abort", undefined, true);
      throw new Error("SNAPSHOT_UNAVAILABLE");
    }
    if (rpcRequests >= RPC_REQUEST_LIMIT || activeRpcRequests >= MAX_CONCURRENT_RPC_REQUESTS) {
      logRpcFailure(trace, method, attempt + 1, 0, "capacity_limit");
      throw new Error("ZCASH_RPC_UNAVAILABLE");
    }
    rpcRequests++;
    activeRpcRequests++;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const abortParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortParent, { once: true });
    if (parentSignal?.aborted) controller.abort();
    let failureCategory = "invalid_response";
    let upstreamStatus: number | undefined;
    let terminalFailure = false;
    try {
      const response = await fetch(config.ZCASH_RPC_URL, {
        method: "POST", headers,
        body: JSON.stringify({ jsonrpc: "1.0", id: ++rpcId, method, params }),
        signal: controller.signal,
      });
      upstreamStatus = response.status;
      if (!response.ok) {
        failureCategory = "http_error";
      } else {
        const body = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
        if (body?.error) {
          failureCategory = "rpc_error";
          terminalFailure = true;
        } else if (body?.result !== undefined) {
          return body.result;
        } else {
          failureCategory = controller.signal.aborted ? parentSignal?.aborted ? "parent_abort" : "timeout" : "invalid_response";
        }
      }
    } catch {
      failureCategory = parentSignal?.aborted ? "parent_abort" : controller.signal.aborted ? "timeout" : "network_error";
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortParent);
      activeRpcRequests--;
    }
    if (parentSignal?.aborted) failureCategory = "parent_abort";
    logRpcFailure(trace, method, attempt + 1, Math.round(performance.now() - startedAt), failureCategory, upstreamStatus, parentSignal?.aborted ?? false);
    if (parentSignal?.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
    if (terminalFailure) throw new Error("ZCASH_RPC_UNAVAILABLE");
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error("ZCASH_RPC_UNAVAILABLE");
}
type ChainInfo = { chain?: string; blocks?: number; upgrades?: Record<string, { name?: string; status?: string }> };
type DecodedTransaction = {
  hex?: string;
  orchard?: { actions?: Array<{
    nullifier?: unknown;
    cmx?: unknown;
    ephemeralKey?: unknown;
    encCiphertext?: unknown;
  }> };
};
type DecodedBlock = {
  hash?: string;
  height?: number;
  previousblockhash?: string;
  tx?: DecodedTransaction[];
};
export type PublicOrchardAction = {
  nullifier: string;
  cmx: string;
  ephemeralKey: string;
  encCiphertext: string;
};
export type PublicIssuanceNote = {
  cmx: string;
  assetBase: string;
  recipient: string;
  value: string;
  rho: string;
  rseed: string;
};
export type PublicActionBlock = {
  height: number;
  hash: string;
  transactions: Array<{ actions: PublicOrchardAction[]; issuanceNotes: PublicIssuanceNote[] }>;
};
type Snapshot = { commitmentRoot: string; exclusionRoot: string };
const MAX_SNAPSHOT_CACHE_ENTRIES = 4;
const SNAPSHOT_DEADLINE_MS = 12 * 60_000;
const snapshotCache = new Map<string, Promise<Snapshot>>();
let activeSnapshotKey: string | undefined;
function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("SNAPSHOT_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("SNAPSHOT_UNAVAILABLE"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}
const VANILLA_COMPACT_NOTE_CIPHERTEXT_BYTES = 52;
const ZSA_COMPACT_NOTE_CIPHERTEXT_BYTES = 84;
const VANILLA_NOTE_CIPHERTEXT_BYTES = 580;
const ZSA_NOTE_CIPHERTEXT_BYTES = 612;
const QEDIT_REGTEST_GENESIS_HASH = "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327";
const QEDIT_ZSA_TESTNET_GENESIS_HASH = "f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756";

async function requireConfiguredNetwork(chain: ChainInfo, signal?: AbortSignal, trace?: RpcTrace): Promise<void> {
  if (chain.chain === "main" || chain.chain === "mainnet") throw new Error("MAINNET_DISABLED");
  if (trace) trace.stage = "snapshot_genesis";
  const genesisHash = await rpc("getblockhash", [0], signal, trace);
  const isTestChain = chain.chain === "test" || chain.chain === "testnet";
  const matchesNetwork = config.NETWORK_ID === "zebra-regtest"
    ? isTestChain && genesisHash === QEDIT_REGTEST_GENESIS_HASH
    : isTestChain && genesisHash === QEDIT_ZSA_TESTNET_GENESIS_HASH;
  if (!matchesNetwork) throw new Error("NETWORK_MISMATCH");
  const zsaUpgradeActive = Object.values(chain.upgrades ?? []).some(
    (upgrade) => upgrade.name === "NU7" && upgrade.status === "active",
  );
  if (!zsaUpgradeActive) throw new Error("ZSA_UNSUPPORTED");
}

export async function getPublicActionBlocks(snapshotHeight: number, start: number, end: number, signal?: AbortSignal, requestId?: string): Promise<PublicActionBlock[]> {
  if (!Number.isSafeInteger(snapshotHeight) || snapshotHeight < 1
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 1 || end < start || end > snapshotHeight || end - start >= 16) {
    throw new Error("INVALID_SNAPSHOT");
  }
  const trace: RpcTrace = { requestId, stage: "public_action_range", snapshotHeight };
  const chain = await rpc("getblockchaininfo", [], signal, trace) as ChainInfo;
  await requireConfiguredNetwork(chain, signal, trace);
  trace.stage = "public_action_range";
  if (!Number.isInteger(chain.blocks) || snapshotHeight > chain.blocks!) throw new Error("INVALID_SNAPSHOT");
  const [snapshotHash, canonicalEndHash] = await Promise.all([
    rpc("getblockhash", [snapshotHeight], signal, trace),
    rpc("getblockhash", [end], signal, { ...trace, blockHeight: end }),
  ]);
  if (typeof snapshotHash !== "string" || !/^[0-9a-f]{64}$/i.test(snapshotHash)
    || typeof canonicalEndHash !== "string" || !/^[0-9a-f]{64}$/i.test(canonicalEndHash)) {
    throw new Error("SNAPSHOT_UNAVAILABLE");
  }
  const heights = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const blockHashes = await Promise.all(heights.map((height) => rpc("getblockhash", [height], signal, { ...trace, blockHeight: height })));
  if (blockHashes.some((hash) => typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash))) {
    throw new Error("SNAPSHOT_UNAVAILABLE");
  }
  const decodedBlocks = await Promise.all(blockHashes.map((hash, index) => rpc("getblock", [hash, 2], signal, { ...trace, blockHeight: heights[index] })));
  const blocks: PublicActionBlock[] = [];
  let previousHash: string | undefined;
  for (let index = 0; index < heights.length; index++) {
    const height = heights[index]!;
    const blockHash = blockHashes[index] as string;
    const block = decodedBlocks[index]! as DecodedBlock;
    if (block.height !== height || block.hash?.toLowerCase() !== blockHash.toLowerCase() || !Array.isArray(block.tx)) {
      throw new Error("SNAPSHOT_UNAVAILABLE");
    }
    if (previousHash && block.previousblockhash?.toLowerCase() !== previousHash) throw new Error("SNAPSHOT_UNAVAILABLE");
    const transactions: Array<{ actions: PublicOrchardAction[]; issuanceNotes: PublicIssuanceNote[] }> = [];
    const rawTransactions: string[] = [];
    for (const transaction of block.tx) {
      if (!transaction || typeof transaction !== "object" || typeof transaction.hex !== "string"
        || !/^(?:[0-9a-f]{2})+$/i.test(transaction.hex)) throw new Error("SNAPSHOT_UNAVAILABLE");
      rawTransactions.push(transaction.hex);
      const actions: PublicOrchardAction[] = [];
      const txActions = transaction.orchard?.actions ?? [];
      if (!Array.isArray(txActions)) throw new Error("SNAPSHOT_UNAVAILABLE");
      for (const action of txActions) {
        if (!action || typeof action !== "object"
          || typeof action.nullifier !== "string" || !/^[0-9a-f]{64}$/i.test(action.nullifier)
          || typeof action.cmx !== "string" || !/^[0-9a-f]{64}$/i.test(action.cmx)
          || typeof action.ephemeralKey !== "string" || !/^[0-9a-f]{64}$/i.test(action.ephemeralKey)
          || typeof action.encCiphertext !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(action.encCiphertext)) {
          throw new Error("SNAPSHOT_UNAVAILABLE");
        }
        const ciphertextLength = action.encCiphertext.length / 2;
        const compactCiphertextLength = ciphertextLength >= ZSA_NOTE_CIPHERTEXT_BYTES
          ? ZSA_COMPACT_NOTE_CIPHERTEXT_BYTES
          : ciphertextLength >= VANILLA_NOTE_CIPHERTEXT_BYTES
            ? VANILLA_COMPACT_NOTE_CIPHERTEXT_BYTES
            : 0;
        if (!compactCiphertextLength) throw new Error("SNAPSHOT_UNAVAILABLE");
        actions.push({
          nullifier: action.nullifier.toLowerCase(),
          cmx: action.cmx.toLowerCase(),
          ephemeralKey: action.ephemeralKey.toLowerCase(),
          encCiphertext: action.encCiphertext.slice(0, compactCiphertextLength * 2).toLowerCase(),
        });
      }
      transactions.push({ actions, issuanceNotes: [] });
    }
    const issuanceNotes = await decodeIssuanceNotes(rawTransactions, signal);
    for (let index = 0; index < transactions.length; index++) {
      transactions[index]!.issuanceNotes = issuanceNotes[index]!.map((note) => {
        if (!note || !/^[0-9a-f]{64}$/i.test(note.cmx)
          || !/^[0-9a-f]{64}$/i.test(note.assetBase)
          || !/^[0-9a-f]{86}$/i.test(note.recipient)
          || !/^(0|[1-9][0-9]*)$/.test(note.value)
          || BigInt(note.value) > 0xffff_ffff_ffff_ffffn
          || !/^[0-9a-f]{64}$/i.test(note.rho)
          || !/^[0-9a-f]{64}$/i.test(note.rseed)) throw new Error("SNAPSHOT_UNAVAILABLE");
        return {
          cmx: note.cmx.toLowerCase(),
          assetBase: note.assetBase.toLowerCase(),
          recipient: note.recipient.toLowerCase(),
          value: note.value,
          rho: note.rho.toLowerCase(),
          rseed: note.rseed.toLowerCase(),
        };
      });
    }
    previousHash = block.hash!.toLowerCase();
    blocks.push({ height, hash: previousHash, transactions });
  }
  const currentEndHash = await rpc("getblockhash", [end], signal, { ...trace, blockHeight: end });
  const currentSnapshotHash = await rpc("getblockhash", [snapshotHeight], signal, trace);
  if (currentEndHash !== canonicalEndHash || currentSnapshotHash !== snapshotHash) throw new Error("SNAPSHOT_UNAVAILABLE");
  return blocks;
}

async function deriveSnapshot(height: number, blockHash: string, commitmentRoot: string, controller: AbortController, trace: RpcTrace): Promise<Snapshot> {
  const signal = controller.signal;
  const nullifiers: string[] = [];
  let previousHash: string | undefined;
  trace.stage = "snapshot_scan";
  for (let start = 1; start <= height; start += 16) {
    if (signal.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
    const end = Math.min(height, start + 15);
    const requests = Array.from({ length: end - start + 1 }, async (_, index) => {
      const blockHeight = start + index;
      const expectedHash = await rpc("getblockhash", [blockHeight], signal, { ...trace, blockHeight });
      if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/i.test(expectedHash)) {
        throw new Error("SNAPSHOT_UNAVAILABLE");
      }
      return { expectedHash, block: await rpc("getblock", [expectedHash, 2], signal, { ...trace, blockHeight }) as DecodedBlock };
    });
    let blocks: Array<{ expectedHash: string; block: DecodedBlock }>;
    try {
      blocks = await Promise.all(requests);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(requests);
      throw error;
    }
    for (let index = 0; index < blocks.length; index++) {
      const blockHeight = start + index;
      const { expectedHash, block } = blocks[index]!;
      if (block.height !== blockHeight || block.hash?.toLowerCase() !== expectedHash.toLowerCase() || !Array.isArray(block.tx)) {
        throw new Error("SNAPSHOT_UNAVAILABLE");
      }
      if (previousHash && block.previousblockhash?.toLowerCase() !== previousHash) {
        throw new Error("SNAPSHOT_UNAVAILABLE");
      }
      previousHash = block.hash!.toLowerCase();
      for (const transaction of block.tx) {
        if (!transaction || typeof transaction !== "object") throw new Error("SNAPSHOT_UNAVAILABLE");
        const actions = transaction.orchard?.actions ?? [];
        if (!Array.isArray(actions)) throw new Error("SNAPSHOT_UNAVAILABLE");
        for (const action of actions) {
          if (!action || typeof action !== "object") throw new Error("SNAPSHOT_UNAVAILABLE");
          if (typeof action.nullifier !== "string" || !/^[0-9a-f]{64}$/i.test(action.nullifier)) {
            throw new Error("SNAPSHOT_UNAVAILABLE");
          }
          nullifiers.push(action.nullifier.toLowerCase());
        }
      }
    }
  }
  if (height > 0 && previousHash !== blockHash.toLowerCase()) {
    throw new Error("SNAPSHOT_UNAVAILABLE");
  }
  if (signal.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
  trace.stage = "snapshot_exclusion_root";
  const exclusionRoot = await deriveExclusionRoot(nullifiers, signal);
  trace.stage = "snapshot_reorg_check";
  const canonicalHash = await rpc("getblockhash", [height], signal, trace);
  if (canonicalHash !== blockHash) throw new Error("SNAPSHOT_UNAVAILABLE");
  return { commitmentRoot, exclusionRoot };
}

export async function resolveSnapshot(height: number, parentSignal?: AbortSignal, requestId?: string): Promise<{ commitmentRoot: string; exclusionRoot: string }> {
  const controller = new AbortController();
  const trace: RpcTrace = { requestId, stage: "snapshot_network", snapshotHeight: height };
  const abortParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortParent, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const startedAt = performance.now();
  let deadlineExceeded = false;
  const deadline = setTimeout(() => { deadlineExceeded = true; controller.abort(); }, SNAPSHOT_DEADLINE_MS);
  try {
    if (controller.signal.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
    trace.stage = "snapshot_network";
    const chain = await rpc("getblockchaininfo", [], controller.signal, trace) as ChainInfo;
    await requireConfiguredNetwork(chain, controller.signal, trace);
    if (!Number.isInteger(chain.blocks) || height > chain.blocks!) throw new Error("INVALID_SNAPSHOT");
    trace.stage = "snapshot_hash";
    const hash = await rpc("getblockhash", [height], controller.signal, trace);
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) throw new Error("SNAPSHOT_UNAVAILABLE");
    trace.stage = "snapshot_treestate";
    const state = await rpc("z_gettreestate", [hash], controller.signal, trace) as {
      height?: number; orchard?: { commitments?: { finalRoot?: string } };
    };
    const root = state.orchard?.commitments?.finalRoot;
    if (state.height !== height || typeof root !== "string" || !/^[0-9a-f]{64}$/i.test(root)) {
      throw new Error("SNAPSHOT_UNAVAILABLE");
    }
    const key = `${chain.chain}:${height}:${hash}`;
    let snapshot = snapshotCache.get(key);
    if (snapshot) {
      snapshotCache.delete(key);
      snapshotCache.set(key, snapshot);
      return await waitForSignal(snapshot, controller.signal);
    }
    trace.stage = "snapshot_scan_admission";
    if (activeSnapshotKey) throw new Error("SNAPSHOT_UNAVAILABLE");

    activeSnapshotKey = key;
    snapshot = deriveSnapshot(height, hash, root, controller, trace)
      .catch((error: unknown) => {
        if (controller.signal.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
        throw error;
      })
      .finally(() => {
        if (activeSnapshotKey === key) activeSnapshotKey = undefined;
      });
    snapshotCache.set(key, snapshot);
    snapshot.catch(() => {
      if (snapshotCache.get(key) === snapshot) snapshotCache.delete(key);
    });
    while (snapshotCache.size > MAX_SNAPSHOT_CACHE_ENTRIES) {
      const oldestKey = snapshotCache.keys().next().value;
      if (oldestKey === undefined) break;
      snapshotCache.delete(oldestKey);
    }
    return await snapshot;
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "";
    const failureCategory = deadlineExceeded ? "snapshot_deadline"
      : parentSignal?.aborted ? "parent_abort"
        : errorCode === "ZCASH_RPC_UNAVAILABLE" ? "rpc_unavailable"
          : errorCode === "VERIFIER_UNAVAILABLE" ? "verifier_unavailable"
            : errorCode === "INVALID_SNAPSHOT" ? "invalid_snapshot"
            : errorCode === "NETWORK_MISMATCH" ? "network_mismatch"
              : errorCode === "ZSA_UNSUPPORTED" ? "protocol_inactive"
                : errorCode === "SNAPSHOT_UNAVAILABLE" ? "snapshot_unavailable"
                  : controller.signal.aborted ? "snapshot_aborted" : "snapshot_failure";
    console.error(JSON.stringify({
      event: "snapshot_failed",
      requestId,
      stage: trace.stage,
      snapshotHeight: height,
      durationMs: Math.round(performance.now() - startedAt),
      failureCategory,
      aborted: controller.signal.aborted,
    }));
    if (controller.signal.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
    throw error;
  } finally {
    clearTimeout(deadline);
    parentSignal?.removeEventListener("abort", abortParent);
  }
}
