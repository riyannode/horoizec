"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { api, type Claim, type ClaimCreationJob } from "../../lib/api";

const dockerJudge = process.env.NEXT_PUBLIC_HOROI_DEMO_MODE === "true";

async function waitForClaimCreation(jobId: string): Promise<Claim> {
  const deadline = Date.now() + 14 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const job = await api<ClaimCreationJob>(`/claims/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "completed" && job.claim) return job.claim;
    if (job.status === "failed") throw new Error(job.error?.message ?? "Claim creation failed.");
    if (job.status === "cancelled") throw new Error("Snapshot scan cancelled.");
  }
  throw new Error("Claim creation timed out. Check the claims list before retrying.");
}

export default function CreateClaim() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Claim | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreated(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const job = await api<ClaimCreationJob>("/claims/jobs", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description"),
          assetId: form.get("assetId"),
          threshold: form.get("threshold"),
          snapshotHeight: Number(form.get("snapshotHeight")),
          expiresAt: form.get("expiresAt") ? Number(form.get("expiresAt")) : null,
        }),
      });
      const jobId = job.jobId;
      setActiveJobId(jobId);
      setCreated(await waitForClaimCreation(jobId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setActiveJobId(null);
      setBusy(false);
    }
  }

  async function cancelSnapshot() {
    if (!activeJobId) return;
    try {
      const job = await api<ClaimCreationJob>(`/claims/jobs/${encodeURIComponent(activeJobId)}/cancel`, { method: "POST" });
      if (job.status === "cancelled") setError("Snapshot scan cancelled.");
      if (job.status === "completed" && job.claim) setCreated(job.claim);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel snapshot scan.");
    }
  }

  return (
    <section className="page narrow">
      <p className="eyebrow">CREATE CLAIM</p>
      <h1>Set the public statement</h1>
      {dockerJudge ? (
        <p className="notice">Docker Judge mode is read-only and does not scan a public chain. Use the pinned fixture walkthrough on <Link href="/demo">the demo page</Link>.</p>
      ) : (
        <>
          <p className="notice">ZSA TESTNET | Experimental | Unaudited | Do not use real funds</p>
          <p>A cold snapshot scans public chain history and can take many minutes. One full scan runs at a time and has a 12-minute scan deadline. You can cancel a running scan. Holders can scan and prove one eligible note locally in the browser.</p>
          <form onSubmit={submit}>
            <label>Name<input name="name" required maxLength={120} /></label>
            <label>Description<textarea name="description" maxLength={2000} /></label>
            <label>AssetId<input name="assetId" required /></label>
            <label>Minimum balance<input name="threshold" required inputMode="numeric" pattern="[1-9][0-9]*" /></label>
            <label>Snapshot height<input name="snapshotHeight" required type="number" min="0" step="1" /></label>
            <label>Expiration (Unix seconds, optional)<input name="expiresAt" type="number" min="1" step="1" /></label>
            <button className="button primary" disabled={busy}>{busy ? "Resolving snapshot…" : "Create snapshot statement"}</button>
            {activeJobId && <button type="button" className="button" onClick={cancelSnapshot}>Cancel snapshot scan</button>}
          </form>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {created && <p className="success" role="status">Snapshot statement created. Eligibility is not yet verified. <Link href={`/claims/${created.id}`}>View statement</Link></p>}
    </section>
  );
}
