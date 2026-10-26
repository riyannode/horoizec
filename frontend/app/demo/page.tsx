"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type Fixture = {
  fixtureId: string;
  provenance: string;
  networkId: string;
  claimId: string;
  protocolVersion: number;
  assetId: string;
  threshold: string;
  snapshotHeight: number;
  commitmentRoot: string;
  exclusionRoot: string;
  expiresAt: number | null;
  alternateNullifier: string;
};
type VerifyResult = { valid: boolean; verifier: string; alternateNullifier?: string; verifierErrorCode?: string };
type ReplayResult = { accepted?: boolean; replayProtection?: string; alternateNullifier?: string; error?: { code?: string; message?: string } };

async function submitReplay(): Promise<{ status: number; body: ReplayResult }> {
  const response = await fetch("/api/v1/demo/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixtureId: "judge-hcp1" }),
  });
  return { status: response.status, body: await response.json() as ReplayResult };
}

export default function Demo() {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [loadError, setLoadError] = useState("");
  const [running, setRunning] = useState("");
  const [validResult, setValidResult] = useState("");
  const [tamperedResult, setTamperedResult] = useState("");
  const [replayResult, setReplayResult] = useState("");

  useEffect(() => {
    api<Fixture>("/demo/fixture").then(setFixture).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "The pinned fixture is unavailable.");
    });
  }, []);

  async function verify(scenario: "valid" | "tampered") {
    setRunning(scenario);
    try {
      const result = await api<VerifyResult>("/demo/verify", { method: "POST", body: JSON.stringify({ scenario }) });
      if (scenario === "valid" && !result.valid) throw new Error("The Rust verifier rejected the pinned valid proof.");
      if (scenario === "tampered" && (result.valid || result.verifierErrorCode !== "INVALID_PROOF")) {
        throw new Error("The Rust verifier did not report cryptographic proof rejection.");
      }
      const message = scenario === "valid"
        ? `HTTP 200 · valid: true · ${result.verifier}`
        : `HTTP 200 · valid: false · ${result.verifier} returned ${result.verifierErrorCode}`;
      if (scenario === "valid") setValidResult(message);
      else setTamperedResult(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed.";
      if (scenario === "valid") setValidResult(`ERROR · ${message}`);
      else setTamperedResult(`ERROR · ${message}`);
    } finally {
      setRunning("");
    }
  }

  async function replay() {
    setRunning("replay");
    setReplayResult("");
    try {
      const first = await submitReplay();
      if (first.status === 409 && first.body.error?.code === "NULLIFIER_USED") {
        setReplayResult("HTTP 409 · NULLIFIER_USED · this persistent demo database already recorded the first acceptance. Reset the local judge volume to replay from a clean state.");
        return;
      }
      if (first.status !== 201 || first.body.accepted !== true) throw new Error(`First submission returned HTTP ${first.status}.`);
      const second = await submitReplay();
      if (second.status !== 409 || second.body.error?.code !== "NULLIFIER_USED") {
        throw new Error(`The duplicate submission returned HTTP ${second.status}, expected HTTP 409 NULLIFIER_USED.`);
      }
      setReplayResult("First submission: HTTP 201 accepted · second identical HCP1 submission: HTTP 409 NULLIFIER_USED.");
    } catch (error) {
      setReplayResult(`ERROR · ${error instanceof Error ? error.message : "Replay scenario failed."}`);
    } finally {
      setRunning("");
    }
  }

  return (
    <section className="page">
      <p className="eyebrow">ZERO-CREDENTIAL DOCKER JUDGE DEMO</p>
      <h1>Private asset ownership, verified.</h1>
      <p className="intro">Horoi binds a private note ownership proof to an immutable AssetId, threshold, and snapshot statement. The fixture buttons call the native Rust/HCP1 verifier; they do not generate a new browser proof.</p>
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {fixture && (
        <>
          <section className="demo-statement" aria-labelledby="statement-title">
            <p className="eyebrow">SELECTED IMMUTABLE CLAIM</p>
            <h2 id="statement-title">Public claim statement</h2>
            <dl>
              <div><dt>Network identifier</dt><dd>{fixture.networkId}</dd></div>
              <div><dt>Protocol version</dt><dd>{fixture.protocolVersion}</dd></div>
              <div className="wide"><dt>AssetId</dt><dd>{fixture.assetId}</dd></div>
              <div><dt>Minimum threshold</dt><dd>{fixture.threshold}</dd></div>
              <div><dt>Snapshot height</dt><dd>{fixture.snapshotHeight}</dd></div>
              <div className="wide"><dt>Commitment root</dt><dd>{fixture.commitmentRoot}</dd></div>
              <div className="wide"><dt>Exclusion root</dt><dd>{fixture.exclusionRoot}</dd></div>
              <div className="wide"><dt>Claim ID</dt><dd>{fixture.claimId}</dd></div>
              <div className="wide"><dt>Claim-specific alternate nullifier</dt><dd>{fixture.alternateNullifier}</dd></div>
            </dl>
          </section>
          <p className="notice"><strong>{fixture.provenance}.</strong> The HCP1 proof was generated by Horoi's Rust scanner test utility from local Orchard test notes and is checked in as a public proof fixture. The <code>zebra-regtest</code> identifier is proof-bound; no Zebra node, QEDIT public testnet, or public-chain scan produced these roots. This is not a public-testnet E2E.</p>
          <div className="demo-grid">
            <section className="demo-card">
              <p className="eyebrow">SCENARIO A</p>
              <h2>Valid ownership proof</h2>
              <p>Load the pinned HCP1 fixture into the same Rust verifier used by the API. Only the public statement and verification result are returned.</p>
              <button className="button primary" disabled={Boolean(running)} onClick={() => void verify("valid")}>{running === "valid" ? "Verifying…" : "Verify valid fixture"}</button>
              <p className="demo-status" role="status" aria-live="polite">{validResult}</p>
            </section>
            <section className="demo-card">
              <p className="eyebrow">SCENARIO B</p>
              <h2>Tampered proof</h2>
              <p>The backend flips one proof byte, then runs that modified HCP1 bundle through the same native verifier. A rejection is shown only from its response.</p>
              <button className="button" disabled={Boolean(running)} onClick={() => void verify("tampered")}>{running === "tampered" ? "Verifying…" : "Verify tampered fixture"}</button>
              <p className="demo-status" role="status" aria-live="polite">{tamperedResult}</p>
            </section>
            <section className="demo-card">
              <p className="eyebrow">SCENARIO C</p>
              <h2>Claim-domain replay</h2>
              <p>Submit the genuine proof once, then submit the same note-level alternate nullifier and proof again. Both requests run HCP1 verification and the SQLite unique-key insert.</p>
              <button className="button" disabled={Boolean(running)} onClick={() => void replay()}>{running === "replay" ? "Submitting twice…" : "Run replay scenario"}</button>
              <p className="demo-status" role="status" aria-live="polite">{replayResult}</p>
            </section>
            <section className="demo-card">
              <p className="eyebrow">SCENARIO D</p>
              <h2>Privacy boundary</h2>
              <div className="demo-boundary">
                <div><strong>PUBLIC</strong><p>AssetId, threshold, snapshot statement, proof result, and claim-specific alternate nullifier.</p></div>
                <div><strong>PRIVATE</strong><p>Spending key, exact note value, witness, private note details, and wallet identity.</p></div>
              </div>
              <p>The fixture verifier runs server-side. No private witness or spending key is included in frontend assets or API requests.</p>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
