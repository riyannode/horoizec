import { spawn, type Subprocess } from "bun";
import { config } from "./config";
type IssuanceNote = { cmx: string; assetBase: string; recipient: string; value: string; rho: string; rseed: string };
type VerifierResponse = { valid?: boolean; errorCode?: string; claimId?: string; claimDomain?: string; assetBase?: string; exclusionRoot?: string; alternateNullifier?: string; issuanceNotes?: IssuanceNote[][] };
const MAX_PENDING_VERIFICATIONS = 8;
const VERIFIER_TIMEOUT_MS = 120_000;

export class Verifier {
  private process?: Subprocess<"pipe", "pipe", "ignore">;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private queue = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly binaryPath = config.VERIFIER_PATH,
    private readonly timeoutMs = VERIFIER_TIMEOUT_MS,
  ) {}

  private start() {
    if (this.process && this.process.exitCode === null && this.reader) {
      return { process: this.process, reader: this.reader };
    }
    const process = spawn([this.binaryPath], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const reader = process.stdout.getReader();
    this.process = process;
    this.reader = reader;
    return { process, reader };
  }

  private async stop(process: Subprocess<"pipe", "pipe", "ignore">) {
    if (this.process === process) {
      this.process = undefined;
      this.reader = undefined;
    }
    try { process.kill("SIGKILL"); } catch {}
    await process.exited.catch(() => undefined);
  }

  private async line(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    let buffered = "";
    while (true) {
      const index = buffered.indexOf("\n");
      if (index >= 0) return buffered.slice(0, index);
      const chunk = await reader.read();
      if (chunk.done) throw new Error("VERIFIER_UNAVAILABLE");
      buffered += new TextDecoder().decode(chunk.value, { stream: true });
    }
  }

  request(value: Record<string, unknown>, signal?: AbortSignal): Promise<VerifierResponse> {
    if (signal?.aborted) return Promise.reject(new Error("SNAPSHOT_UNAVAILABLE"));
    if (this.pending >= MAX_PENDING_VERIFICATIONS) return Promise.reject(new Error("RATE_LIMITED"));
    this.pending++;

    let started = false;
    let queuedAbortListener: (() => void) | undefined;
    let cancelledInQueue: Promise<never> | undefined;
    if (signal) {
      cancelledInQueue = new Promise<never>((_, reject) => {
        queuedAbortListener = () => {
          if (!started) reject(new Error("SNAPSHOT_UNAVAILABLE"));
        };
        signal.addEventListener("abort", queuedAbortListener, { once: true });
      });
    }

    const run = this.queue.then(async () => {
      if (signal?.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
      started = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let operation: ReturnType<Verifier["start"]> | undefined;
      let abortListener: (() => void) | undefined;
      try {
        operation = this.start();
        const { process, reader } = operation;
        const response = new Promise<VerifierResponse>((resolve, reject) => {
          let cancelled = false;
          const stop = (error: Error) => {
            if (cancelled) return;
            cancelled = true;
            void this.stop(process).then(() => reject(error));
          };
          timeout = setTimeout(() => stop(new Error("VERIFIER_UNAVAILABLE")), this.timeoutMs);
          abortListener = () => stop(new Error("SNAPSHOT_UNAVAILABLE"));
          signal?.addEventListener("abort", abortListener, { once: true });
          if (signal?.aborted) abortListener();
          void (async () => {
            if (cancelled || signal?.aborted) throw new Error("SNAPSHOT_UNAVAILABLE");
            process.stdin.write(`${JSON.stringify(value)}\n`);
            await process.stdin.flush();
            return JSON.parse(await this.line(reader)) as VerifierResponse;
          })().then(resolve, reject);
        });
        return await response;
      } catch (error) {
        if (operation) await this.stop(operation.process);
        if (signal?.aborted || (error instanceof Error && error.message === "SNAPSHOT_UNAVAILABLE")) {
          throw new Error("SNAPSHOT_UNAVAILABLE");
        }
        throw new Error("VERIFIER_UNAVAILABLE");
      } finally {
        if (timeout) clearTimeout(timeout);
        if (abortListener) signal?.removeEventListener("abort", abortListener);
      }
    });
    const settledRun = run.finally(() => { this.pending--; });
    this.queue = settledRun.then(() => undefined, () => undefined);
    const result = cancelledInQueue ? Promise.race([settledRun, cancelledInQueue]) : settledRun;
    return result.finally(() => {
      if (queuedAbortListener) signal?.removeEventListener("abort", queuedAbortListener);
    });
  }
}

const verifier = new Verifier();
export async function validateAssetId(assetId: string, signal?: AbortSignal) {
  const result = await verifier.request({ operation: "validateAsset", assetId }, signal);
  if (!result.assetBase) throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  return result.assetBase;
}
function rustStatement(statement: Record<string, unknown>) {
  return { ...statement, expiresAt: typeof statement.expiresAt === "number" ? String(statement.expiresAt) : statement.expiresAt };
}
export async function deriveClaim(statement: Record<string, unknown>, signal?: AbortSignal) {
  const result = await verifier.request({ operation: "deriveClaim", ...rustStatement(statement) }, signal);
  if (!result.claimId || !result.claimDomain) throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  return result;
}
export async function deriveExclusionRoot(nullifiers: string[], signal?: AbortSignal) {
  const result = await verifier.request({ operation: "exclusionRoot", nullifiers }, signal);
  if (!result.exclusionRoot) throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  return result.exclusionRoot;
}
export async function decodeIssuanceNotes(transactions: string[], signal?: AbortSignal) {
  const result = await verifier.request({ operation: "issuanceNotes", transactions }, signal);
  if (!result.issuanceNotes || result.issuanceNotes.length !== transactions.length) {
    throw new Error(result.errorCode ?? "VERIFIER_UNAVAILABLE");
  }
  return result.issuanceNotes;
}
export async function verifyProof(statement: Record<string, unknown>, proof: string, signal?: AbortSignal) {
  return verifier.request({ ...rustStatement(statement), proofBundle: proof }, signal);
}
