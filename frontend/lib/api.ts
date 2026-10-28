export interface Claim {
  id: string; protocolVersion: number; networkId: string; name: string; description: string;
  assetId: string; threshold: string; snapshotHeight: number; commitmentRoot: string;
  exclusionRoot: string; claimDomain: string; creatorNonce: string; expiresAt: number | null; createdAt: number;
  status: "active" | "expired";
}
export interface ClaimCreationJob {
  jobId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  claim?: Claim;
  error?: { code: string; message: string };
}
export interface ProofSubmissionJob {
  jobId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stage: string;
  result?: { accepted: true; replayProtection: "note-level" };
  error?: { code: string; message: string };
}
export interface PublicOrchardAction {
  nullifier: string;
  cmx: string;
  ephemeralKey: string;
  encCiphertext: string;
}
export interface PublicIssuanceNote {
  cmx: string;
  assetBase: string;
  recipient: string;
  value: string;
  rho: string;
  rseed: string;
}
export interface PublicActionBlock {
  height: number;
  hash: string;
  transactions: Array<{ actions: PublicOrchardAction[]; issuanceNotes: PublicIssuanceNote[] }>;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json() as T | { error: { code: string; message: string } };
  if (!response.ok) {
    const error = body as { error?: { code?: string; message?: string } };
    throw new Error(error.error?.message ?? error.error?.code ?? "Request failed.");
  }
  return body as T;
}
export async function publicActionBlocks(snapshotHeight: number, start: number, end: number): Promise<PublicActionBlock[]> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const { blocks } = await api<{ blocks: PublicActionBlock[] }>(
        `/snapshots/${snapshotHeight}/actions?start=${start}&end=${end}`,
      );
      return blocks;
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof SyntaxError) || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.min(2 ** attempt, 8)));
    }
  }
  throw new Error("The public chain data request failed.");
}
