"use client";
import { type FormEvent,useState } from "react";
import Link from "next/link";
import { api, type Claim } from "../../lib/api";
const dockerJudge=process.env.NEXT_PUBLIC_HOROI_DEMO_MODE==="true";
export default function CreateClaim() {
 const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const [created,setCreated]=useState<Claim|null>(null);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); setError(""); setCreated(null); setBusy(true); const f=new FormData(event.currentTarget);
  try { const result=await api<{claim:Claim}>("/claims",{method:"POST",body:JSON.stringify({name:f.get("name"),description:f.get("description"),assetId:f.get("assetId"),threshold:f.get("threshold"),snapshotHeight:Number(f.get("snapshotHeight")),expiresAt:f.get("expiresAt")?Number(f.get("expiresAt")):null})}); setCreated(result.claim); }
  catch(e) { setError(e instanceof Error?e.message:"Request failed."); } finally { setBusy(false); }
 }
 return <section className="page narrow"><p className="eyebrow">CREATE CLAIM</p><h1>Set the public statement</h1>{dockerJudge?<p className="notice">Docker Judge mode is read-only and does not scan a public chain. Use the pinned fixture walkthrough on <Link href="/demo">the demo page</Link>.</p>:<><p className="notice">ZSA TESTNET | Experimental | Unaudited | Do not use real funds</p><p>Snapshot roots are derived from public chain data. Holders can scan and prove one eligible note locally in the browser.</p><form onSubmit={submit}><label>Name<input name="name" required maxLength={120}/></label><label>Description<textarea name="description" maxLength={2000}/></label><label>AssetId<input name="assetId" required/></label><label>Minimum balance<input name="threshold" required inputMode="numeric" pattern="[1-9][0-9]*"/></label><label>Snapshot height<input name="snapshotHeight" required type="number" min="0" step="1"/></label><label>Expiration (Unix seconds, optional)<input name="expiresAt" type="number" min="1" step="1"/></label><button className="button primary" disabled={busy}>{busy?"Resolving snapshot…":"Create snapshot statement"}</button></form></>}{error&&<p className="error" role="alert">{error}</p>}{created&&<p className="success" role="status">Snapshot statement created. Eligibility is not yet verified. <Link href={`/claims/${created.id}`}>View statement</Link></p>}</section>;
}
