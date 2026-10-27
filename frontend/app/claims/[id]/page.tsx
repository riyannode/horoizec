"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, publicActionBlocks, type Claim, type ProofSubmissionJob } from "../../../lib/api";
const dockerJudge = process.env.NEXT_PUBLIC_HOROI_DEMO_MODE === "true";

function bytes32(value: string, field: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2}){32}$/.test(value)) throw new Error(`${field} must be 32-byte hexadecimal.`);
  return hexBytes(value);
}

function assetIdBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2}){66}$/.test(value)) throw new Error("assetId must be 66-byte hexadecimal.");
  return hexBytes(value);
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function loadPublicActions(snapshotHeight: number, reportProgress: (height: number) => void): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (let start = 1; start <= snapshotHeight; start += 16) {
    const end = Math.min(snapshotHeight, start + 15);
    const blocks = await publicActionBlocks(snapshotHeight, start, end);
    if (blocks.length !== end - start + 1) throw new Error("The chain data range was incomplete.");
    const rangeActions: Uint8Array[] = [];
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]!;
      if (block.height !== start + index || !/^[0-9a-f]{64}$/i.test(block.hash)) throw new Error("The chain data range was inconsistent.");
      for (const transaction of block.transactions) {
        for (const action of transaction.actions) {
        if (!/^[0-9a-f]{64}$/i.test(action.nullifier)
          || !/^[0-9a-f]{64}$/i.test(action.cmx)
          || !/^[0-9a-f]{64}$/i.test(action.ephemeralKey)
          || !/^(?:[0-9a-f]{2}){52}$/i.test(action.encCiphertext)
            && !/^(?:[0-9a-f]{2}){84}$/i.test(action.encCiphertext)) {
          throw new Error("The chain data range contained an invalid Orchard action.");
        }
        const ciphertextLength = action.encCiphertext.length / 2;
          rangeActions.push(hexBytes(
            "01" + action.nullifier + action.cmx + action.ephemeralKey
            + ciphertextLength.toString(16).padStart(2, "0") + action.encCiphertext,
          ));
        }
        for (const note of transaction.issuanceNotes) {
          if (!/^[0-9a-f]{64}$/i.test(note.cmx)
            || !/^[0-9a-f]{64}$/i.test(note.assetBase)
            || !/^[0-9a-f]{86}$/i.test(note.recipient)
            || !/^(0|[1-9][0-9]*)$/.test(note.value)
            || !/^[0-9a-f]{64}$/i.test(note.rho)
            || !/^[0-9a-f]{64}$/i.test(note.rseed)) {
            throw new Error("The chain data range contained an invalid issuance note.");
          }
          const value = BigInt(note.value);
          if (value > BigInt("18446744073709551615")) throw new Error("The chain data range contained an invalid issuance note.");
          const valueBytes = new Uint8Array(8);
          new DataView(valueBytes.buffer).setBigUint64(0, value, true);
          rangeActions.push(concat([
            hexBytes("03" + note.cmx + note.assetBase + note.recipient),
            valueBytes,
            hexBytes(note.rho + note.rseed),
          ]));
        }
      }
    }
    if (rangeActions.length > 0) chunks.push(concat(rangeActions));
    reportProgress(end);
  }
  return concat(chunks);
}

export default function ClaimDetails() {
  const { id } = useParams<{ id: string }>();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [progress, setProgress] = useState("");
  const [proofJobId, setProofJobId] = useState("");
  const spendingKeyInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api<{ claim: Claim }>(`/claims/${encodeURIComponent(id)}`)
      .then(({ claim }) => {
        if (active) setClaim(claim);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load this claim.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function proveAndSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claim) return;
    setBusy(true);
    setResult("");
    setError("");
    try {
      const spendingKey = bytes32(spendingKeyInput.current?.value ?? "", "spendingKey");
      setProgress("Loading public OrchardZSA actions from block 1…");
      const packedActions = await loadPublicActions(claim.snapshotHeight, (height) => {
        setProgress(`Loading public OrchardZSA actions through block ${height} of ${claim.snapshotHeight}…`);
      });
      if (packedActions.length === 0) throw new Error("This snapshot contains no OrchardZSA actions.");
      setProgress("Scanning local notes and proving in this browser…");
      const claimWasm = await import(/* webpackIgnore: true */ "/claim.js");
      await claimWasm.default();
      const proof = claimWasm.scan_and_prove_single_note_claim_wasm(
        claim.networkId,
        assetIdBytes(claim.assetId),
        BigInt(claim.threshold),
        claim.snapshotHeight,
        bytes32(claim.commitmentRoot, "commitmentRoot"),
        bytes32(claim.exclusionRoot, "exclusionRoot"),
        claim.expiresAt === null ? undefined : BigInt(claim.expiresAt),
        bytes32(claim.creatorNonce, "creatorNonce"),
        spendingKey,
        packedActions,
      );
      setProgress("Submitting proof…");
      const alternateNullifier = claimWasm.claim_proof_alternate_nullifier(proof);
      const path = `/claims/${encodeURIComponent(claim.id)}/submit/jobs`;
      const proofInput = {
        claimId: claim.id,
        protocolVersion: claim.protocolVersion,
        proof: encodeBase64(proof),
        alternateNullifiers: [alternateNullifier],
      };
      const started = await api<ProofSubmissionJob>(path, {
        method: "POST",
        body: JSON.stringify(proofInput),
      });
      setProofJobId(started.jobId);
      let job = started;
      while (job.status === "running") {
        setProgress(`Verifying proof and snapshot… ${job.stage}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        job = await api<ProofSubmissionJob>(`${path}/${encodeURIComponent(started.jobId)}`);
      }
      if (job.status === "failed") throw new Error(`${job.error?.code ?? "PROOF_SUBMISSION_FAILED"}: ${job.error?.message ?? "Proof submission failed."}`);
      if (job.status === "cancelled") throw new Error("Proof submission was cancelled.");
      setResult("Claim accepted with note-level replay protection.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (spendingKeyInput.current) spendingKeyInput.current.value = "";
      setBusy(false);
      setProgress("");
      setProofJobId("");
    }
  }

  async function cancelProofSubmission() {
    if (!claim || !proofJobId) return;
    try {
      await api<ProofSubmissionJob>(`/claims/${encodeURIComponent(claim.id)}/submit/jobs/${encodeURIComponent(proofJobId)}/cancel`, { method: "POST" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <section className="page narrow">
      <p className="eyebrow">CLAIM DETAILS</p>
      {loading && <p role="status">Loading claim…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {claim && (
        <>
          <h1>{claim.name}</h1>
          <p className="notice">ZSA TESTNET | Experimental | Unaudited | Do not use real funds</p>
          {claim.description && <p>{claim.description}</p>}
          <dl className="claim-facts">
            <div><dt>AssetId</dt><dd>{claim.assetId}</dd></div>
            <div><dt>Threshold</dt><dd>{claim.threshold}</dd></div>
            <div><dt>Snapshot</dt><dd>Block {claim.snapshotHeight} on {claim.networkId}</dd></div>
            <div><dt>Commitment root</dt><dd>{claim.commitmentRoot}</dd></div>
            <div><dt>Exclusion root</dt><dd>{claim.exclusionRoot}</dd></div>
            <div><dt>Expires</dt><dd>{claim.expiresAt === null ? "Never" : new Date(claim.expiresAt * 1000).toISOString()}</dd></div>
          </dl>
          <div className="actions">
            <Link className="button" href="/verify">Verify a proof bundle</Link>
          </div>
          {dockerJudge ? (
            <p className="notice">This Docker fixture is not a live chain snapshot and has no browser proof-generation inputs. Run the separate server-side fixture verification scenarios on <Link href="/demo">the demo page</Link>.</p>
          ) : (
            <>
              <p className="notice">Experimental, unaudited. This proof currently supports one normal note. A cold scan downloads public actions in 16-block ranges and may take a long time. The spending key, note scanning, and witness construction stay in this browser; only public chain data is downloaded and the proof with public claim fields is submitted.</p>
              <form className="proof-form" onSubmit={proveAndSubmit}>
                <label>Testnet spending key (32-byte hex)<input ref={spendingKeyInput} type="password" autoComplete="off" required pattern="(?:[0-9a-fA-F]{2}){32}" /></label>
                <p className="notice">Use a testnet-only key. It is processed locally and never sent to the backend. Do not use a mainnet key.</p>
                <button className="button primary" disabled={busy}>{busy ? "Working…" : "Scan locally and submit proof"}</button>
                {busy && <button className="button" type="button" disabled={!proofJobId} onClick={cancelProofSubmission}>Cancel proof verification</button>}
              </form>
            </>
          )}
          {progress && <p role="status">{progress}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {result && <p className="success" role="status">{result}</p>}
        </>
      )}
    </section>
  );
}
