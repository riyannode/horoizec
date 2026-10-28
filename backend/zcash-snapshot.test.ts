import { describe, expect, it } from "bun:test";
import { config } from "./config";
import { resolveSnapshot } from "./zcash";
import { snapshotScanCheckpoints } from "./zcash-checkpoints";

const genesisHash = "f41f61ddf9610ae40f519ad2e9e543e065ef0357eeecf5a4cc08a765d9505756";
const commitmentRoot = "ab".repeat(32);

describe("snapshot scan resume", () => {
  it("reuses a completed range only after rechecking its canonical end hash", async () => {
    const originalFetch = globalThis.fetch;
    const originalNetwork = config.NETWORK_ID;
    const calls: Array<{ method: string; height?: number }> = [];
    const hashAt = (height: number) => height === 0 ? genesisHash : height.toString(16).padStart(64, "0");
    config.NETWORK_ID = "zsa-testnet";
    snapshotScanCheckpoints.clear();

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      const height = request.method === "getblockhash" ? Number(request.params[0]) : undefined;
      calls.push({ method: request.method, height });
      let result: unknown;
      if (request.method === "getblockchaininfo") {
        result = { chain: "test", blocks: 16, upgrades: { nu7: { name: "NU7", status: "active" } } };
      } else if (request.method === "getblockhash") {
        result = hashAt(height!);
      } else if (request.method === "z_gettreestate") {
        result = { height: 16, orchard: { commitments: { finalRoot: commitmentRoot } } };
      } else if (request.method === "getblock") {
        const hash = String(request.params[0]);
        const blockHeight = hash === genesisHash ? 0 : Number.parseInt(hash, 16);
        result = { hash, height: blockHeight, previousblockhash: hashAt(blockHeight - 1), tx: [] };
      } else {
        throw new Error(`Unexpected RPC method ${request.method}`);
      }
      return new Response(JSON.stringify({ result, error: null }), { status: 200 });
    }) as typeof fetch;

    try {
      const firstAttempt = new AbortController();
      await expect(resolveSnapshot(16, firstAttempt.signal, "checkpoint-test", (height) => {
        if (height === 16) firstAttempt.abort();
      })).rejects.toThrow("SNAPSHOT_UNAVAILABLE");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const blocksFetchedBeforeResume = calls.filter((call) => call.method === "getblock").length;
      expect(blocksFetchedBeforeResume).toBe(16);

      const resumed = await resolveSnapshot(16, undefined, "checkpoint-resume");

      expect(resumed).toEqual({ commitmentRoot, exclusionRoot: expect.any(String) });
      expect(calls.filter((call) => call.method === "getblock").length).toBe(blocksFetchedBeforeResume);
      expect(snapshotScanCheckpoints.has("test:16:" + hashAt(16), 1, 16)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      config.NETWORK_ID = originalNetwork;
      snapshotScanCheckpoints.clear();
    }
  });
});
