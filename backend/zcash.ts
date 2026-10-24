import { config } from "./config";
import { decodeIssuanceNotes, deriveExclusionRoot } from "./proof";
let rpcId = 0;
async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const headers = new Headers({ "content-type": "application/json" });
  if (config.ZCASH_RPC_USER && config.ZCASH_RPC_PASSWORD) {
    headers.set("authorization", `Basic ${btoa(`${config.ZCASH_RPC_USER}:${config.ZCASH_RPC_PASSWORD}`)}`);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(config.ZCASH_RPC_URL, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "1.0", id: ++rpcId, method, params }),
      signal: AbortSignal.timeout(10_000)
    }).catch(() => null);
    if (response?.ok) {
      const body = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
      if (body?.error || body?.result !== undefined) {
        if (body.error || body.result === undefined) throw new Error("ZCASH_RPC_UNAVAILABLE");
        return body.result;
      }
    }
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
const snapshotCache = new Map<string, Promise<Snapshot>>();
const VANILLA_COMPACT_NOTE_CIPHERTEXT_BYTES = 52;
const ZSA_COMPACT_NOTE_CIPHERTEXT_BYTES = 84;
const VANILLA_NOTE_CIPHERTEXT_BYTES = 580;
const ZSA_NOTE_CIPHERTEXT_BYTES = 612;
const QEDIT_REGTEST_GENESIS_HASH = "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327";

async function requireConfiguredNetwork(chain: ChainInfo): Promise<void> {
  if (chain.chain === "main" || chain.chain === "mainnet") throw new Error("MAINNET_DISABLED");
  const genesisHash = await rpc("getblockhash", [0]);
  const isTestChain = chain.chain === "test" || chain.chain === "testnet";
  const matchesNetwork = config.NETWORK_ID === "zebra-regtest"
    ? isTestChain && genesisHash === QEDIT_REGTEST_GENESIS_HASH
    : isTestChain && genesisHash !== QEDIT_REGTEST_GENESIS_HASH;
  if (!matchesNetwork) throw new Error("NETWORK_MISMATCH");
  const zsaUpgradeActive = Object.values(chain.upgrades ?? []).some(
    (upgrade) => upgrade.name === "NU7" && upgrade.status === "active",
  );
  if (!zsaUpgradeActive) throw new Error("ZSA_UNSUPPORTED");
}

export async function getPublicActionBlocks(snapshotHeight: number, start: number, end: number): Promise<PublicActionBlock[]> {
  if (!Number.isSafeInteger(snapshotHeight) || snapshotHeight < 1
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 1 || end < start || end > snapshotHeight || end - start >= 16) {
    throw new Error("INVALID_SNAPSHOT");
  }
  const chain = await rpc("getblockchaininfo") as ChainInfo;
  await requireConfiguredNetwork(chain);
  if (!Number.isInteger(chain.blocks) || snapshotHeight > chain.blocks!) throw new Error("INVALID_SNAPSHOT");
  const [snapshotHash, canonicalEndHash] = await Promise.all([
    rpc("getblockhash", [snapshotHeight]),
    rpc("getblockhash", [end]),
  ]);
  if (typeof snapshotHash !== "string" || !/^[0-9a-f]{64}$/i.test(snapshotHash)
    || typeof canonicalEndHash !== "string" || !/^[0-9a-f]{64}$/i.test(canonicalEndHash)) {
    throw new Error("SNAPSHOT_UNAVAILABLE");
  }
  const blocks: PublicActionBlock[] = [];
  let previousHash: string | undefined;
  for (let height = start; height <= end; height++) {
    const blockHash = await rpc("getblockhash", [height]);
    if (typeof blockHash !== "string" || !/^[0-9a-f]{64}$/i.test(blockHash)) throw new Error("SNAPSHOT_UNAVAILABLE");
    const block = await rpc("getblock", [blockHash, 2]) as DecodedBlock;
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
    const issuanceNotes = await decodeIssuanceNotes(rawTransactions);
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
  const currentEndHash = await rpc("getblockhash", [end]);
  const currentSnapshotHash = await rpc("getblockhash", [snapshotHeight]);
  if (currentEndHash !== canonicalEndHash || currentSnapshotHash !== snapshotHash) throw new Error("SNAPSHOT_UNAVAILABLE");
  return blocks;
}

async function deriveSnapshot(height: number, blockHash: string, commitmentRoot: string): Promise<Snapshot> {
  const nullifiers: string[] = [];
  let previousHash: string | undefined;
  for (let start = 1; start <= height; start += 16) {
    const end = Math.min(height, start + 15);
    const blocks = await Promise.all(Array.from({ length: end - start + 1 }, async (_, index) => {
      const expectedHash = await rpc("getblockhash", [start + index]);
      if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/i.test(expectedHash)) {
        throw new Error("SNAPSHOT_UNAVAILABLE");
      }
      return { expectedHash, block: await rpc("getblock", [expectedHash, 2]) as DecodedBlock };
    }));
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
  const exclusionRoot = await deriveExclusionRoot(nullifiers);
  const canonicalHash = await rpc("getblockhash", [height]);
  if (canonicalHash !== blockHash) throw new Error("SNAPSHOT_UNAVAILABLE");
  return { commitmentRoot, exclusionRoot };
}

export async function resolveSnapshot(height: number): Promise<{ commitmentRoot: string; exclusionRoot: string }> {
  const chain = await rpc("getblockchaininfo") as ChainInfo;
  await requireConfiguredNetwork(chain);
  if (!Number.isInteger(chain.blocks) || height > chain.blocks!) throw new Error("INVALID_SNAPSHOT");
  const hash = await rpc("getblockhash", [height]);
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash)) throw new Error("SNAPSHOT_UNAVAILABLE");
  const state = await rpc("z_gettreestate", [hash]) as {
    height?: number; orchard?: { commitments?: { finalRoot?: string } };
  };
  const root = state.orchard?.commitments?.finalRoot;
  if (state.height !== height || typeof root !== "string" || !/^[0-9a-f]{64}$/i.test(root)) {
    throw new Error("SNAPSHOT_UNAVAILABLE");
  }
  const key = `${chain.chain}:${height}:${hash}`;
  let snapshot = snapshotCache.get(key);
  if (!snapshot) {
    snapshot = deriveSnapshot(height, hash, root);
    snapshotCache.set(key, snapshot);
    snapshot.catch(() => snapshotCache.delete(key));
  }
  return snapshot;
}
