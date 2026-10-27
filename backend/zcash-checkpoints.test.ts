import { describe, expect, it } from "bun:test";
import { SnapshotScanCheckpointCache } from "./zcash-checkpoints";

describe("snapshot scan checkpoints", () => {
  it("reuses a completed range only when its canonical end hash matches", () => {
    const cache = new SnapshotScanCheckpointCache();
    const key = "zsa-testnet:16:target";

    cache.set(key, 1, 16, "a".repeat(64), ["nullifier-1"]);

    expect(cache.get(key, 1, 16, "a".repeat(64))).toEqual(["nullifier-1"]);
    expect(cache.get(key, 1, 16, "b".repeat(64))).toBeUndefined();
  });

  it("invalidates the changed range and every later range after a reorg", () => {
    const cache = new SnapshotScanCheckpointCache();
    const key = "zsa-testnet:48:target";
    cache.set(key, 1, 16, "a".repeat(64), ["n1"]);
    cache.set(key, 17, 32, "b".repeat(64), ["n2"]);
    cache.set(key, 33, 48, "c".repeat(64), ["n3"]);

    expect(cache.get(key, 17, 32, "d".repeat(64))).toBeUndefined();
    expect(cache.get(key, 1, 16, "a".repeat(64))).toEqual(["n1"]);
    expect(cache.get(key, 33, 48, "c".repeat(64))).toBeUndefined();
  });

  it("keeps checkpoints for only one snapshot key", () => {
    const cache = new SnapshotScanCheckpointCache();
    cache.set("zsa-testnet:16:old", 1, 16, "a".repeat(64), ["n1"]);
    cache.set("zsa-testnet:16:new", 1, 16, "b".repeat(64), ["n2"]);

    expect(cache.get("zsa-testnet:16:old", 1, 16, "a".repeat(64))).toBeUndefined();
    expect(cache.get("zsa-testnet:16:new", 1, 16, "b".repeat(64))).toEqual(["n2"]);
  });

  it("clears checkpoints when the range limit is reached", () => {
    const cache = new SnapshotScanCheckpointCache();
    const key = "zsa-testnet:160016:target";
    for (let index = 0; index <= 10_000; index++) {
      const start = index * 16 + 1;
      cache.set(key, start, start + 15, "a".repeat(64), []);
    }

    expect(cache.has(key, 1, 16)).toBe(false);
    expect(cache.has(key, 159_985, 160_000)).toBe(false);
  });
});
