"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import { api,type Claim } from "../../lib/api";
export default function Claims() {
 const [claims,setClaims]=useState<Claim[]>([]); const [error,setError]=useState("");
 useEffect(()=>{api<{claims:Claim[]}>("/claims").then(d=>setClaims(d.claims)).catch((e:Error)=>setError(e.message));},[]);
 return <section className="page"><p className="eyebrow">PUBLIC CLAIMS</p><h1>Browse claims</h1>{error&&<p className="error">{error}</p>}{!error&&claims.length===0?<p className="empty">No claims yet.</p>:<div className="claim-list">{claims.map(c=><Link className="claim-card" href={`/claims/${c.id}`} key={c.id}><strong>{c.name}</strong><span>{c.threshold} | {c.assetId.slice(0,14)}...</span><span>Snapshot {c.snapshotHeight} | {c.networkId}</span><span>Status: {c.status}</span></Link>)}</div>}</section>;
}