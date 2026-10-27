type Checkpoint = { end: number; endHash: string; nullifiers: string[] };

const MAX_CACHED_NULLIFIERS = 200_000;
const MAX_CACHED_RANGES = 10_000;

export class SnapshotScanCheckpointCache {
  private key: string | undefined;
  private readonly chunks = new Map<number, Checkpoint>();
  private nullifierCount = 0;

  has(key: string, start: number, end: number): boolean {
    return this.key === key && this.chunks.get(start)?.end === end;
  }

  get(key: string, start: number, end: number, canonicalEndHash: string): readonly string[] | undefined {
    if (this.key !== key) return undefined;
    const checkpoint = this.chunks.get(start);
    if (!checkpoint) return undefined;
    if (checkpoint.end !== end || checkpoint.endHash !== canonicalEndHash) {
      this.deleteFrom(start);
      return undefined;
    }
    return checkpoint.nullifiers;
  }

  set(key: string, start: number, end: number, endHash: string, nullifiers: string[]): void {
    if (this.key !== key) {
      this.clear();
      this.key = key;
    }
    const previous = this.chunks.get(start);
    if (previous) this.nullifierCount -= previous.nullifiers.length;
    if ((previous === undefined && this.chunks.size >= MAX_CACHED_RANGES)
      || this.nullifierCount + nullifiers.length > MAX_CACHED_NULLIFIERS) {
      this.clear();
      return;
    }
    const copy = [...nullifiers];
    this.chunks.set(start, { end, endHash, nullifiers: copy });
    this.nullifierCount += copy.length;
  }

  clear(key?: string): void {
    if (key !== undefined && this.key !== key) return;
    this.key = undefined;
    this.chunks.clear();
    this.nullifierCount = 0;
  }

  private deleteFrom(start: number): void {
    for (const [rangeStart, checkpoint] of this.chunks) {
      if (rangeStart >= start) {
        this.nullifierCount -= checkpoint.nullifiers.length;
        this.chunks.delete(rangeStart);
      }
    }
  }
}

export const snapshotScanCheckpoints = new SnapshotScanCheckpointCache();
