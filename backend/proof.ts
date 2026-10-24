import { spawn, type Subprocess } from "bun";
import { config } from "./config";
type IssuanceNote = { cmx: string; assetBase: string; recipient: string; value: string; rho: string; rseed: string };
type VerifierResponse = { valid?: boolean; errorCode?: string; claimId?: string; claimDomain?: string; assetBase?: string; exclusionRoot?: string; alternateNullifier?: string; issuanceNotes?: IssuanceNote[][] };
class Verifier {
  private process?: Subprocess<"pipe", "pipe", "ignore">;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private buffered = "";
  private queue = Promise.resolve();
  private start() {
    if (this.process && this.process.exitCode === null) return;
    this.process = spawn([config.VERIFIER_PATH], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.reader = this.process.stdout.getReader();
  }
  private async line(): Promise<string> {
    this.start();
    while (true) {
      const index = this.buffered.indexOf("\n");
      if (index >= 0) {
        const result = this.buffered.slice(0, index);
        this.buffered = this.buffered.slice(index + 1);
        return result;
      }
      const chunk = await this.reader!.read();
      if (chunk.done) throw new Error("VERIFIER_UNAVAILABLE");
      this.buffered += new TextDecoder().decode(chunk.value, { stream: true });
    }
  }
  request(value: Record<string, unknown>): Promise<VerifierResponse> {
    const run = this.queue.then(async () => {
      this.start();
      this.process!.stdin.write(`${JSON.stringify(value)}\n`);
      await this.process!.stdin.flush();
      return JSON.parse(await this.line()) as VerifierResponse;
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
const verifier = new Verifier();
export async function validateAssetId(assetId: string) {
  const result = await verifier.request({ operation: "validateAsset", assetId });
  if (!result.assetBase) throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  return result.assetBase;
}
function rustStatement(statement: Record<string, unknown>) {
  return { ...statement, expiresAt: typeof statement.expiresAt === "number" ? String(statement.expiresAt) : statement.expiresAt };
}
export async function deriveClaim(statement: Record<string, unknown>) {
  const result = await verifier.request({ operation: "deriveClaim", ...rustStatement(statement) });
  if (!result.claimId || !result.claimDomain) throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  return result;
}
export async function deriveExclusionRoot(nullifiers: string[]) {
  const result = await verifier.request({ operation: "exclusionRoot", nullifiers });
  if (!result.exclusionRoot) throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  return result.exclusionRoot;
}
export async function decodeIssuanceNotes(transactions: string[]) {
  const result = await verifier.request({ operation: "issuanceNotes", transactions });
  if (!result.issuanceNotes || result.issuanceNotes.length !== transactions.length) {
    throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  }
  return result.issuanceNotes;
}
export async function verifyProof(statement: Record<string, unknown>, proof: string) {
  return verifier.request({ ...rustStatement(statement), proofBundle: proof });
}
