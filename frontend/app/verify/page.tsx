"use client";
import { type FormEvent,useState } from "react";
import { api } from "../../lib/api";

type VerifiedStatement = {
 assetId: string;
 threshold: string;
 snapshotHeight: number;
 protocolVersion: number;
};
type VerificationResult = {
 valid: boolean;
 message?: string;
 statement?: VerifiedStatement;
};

export default function Verify() {
 const [result,setResult]=useState<VerificationResult|null>(null);
 async function submit(event:FormEvent<HTMLFormElement>) {
  event.preventDefault(); setResult(null); const f=new FormData(event.currentTarget);
  try {
   const r=await api<{valid:boolean;statement?:VerifiedStatement}>("/proofs/verify",{method:"POST",body:JSON.stringify({claimId:f.get("claimId"),protocolVersion:1,proof:f.get("proof"),alternateNullifiers:String(f.get("alternateNullifiers")).split(",").map(x=>x.trim())})});
   if(!r.valid) { setResult({valid:false}); return; }
   if(!r.statement) throw new Error("The verifier response did not include the public statement.");
   setResult({valid:true,statement:r.statement});
  }
  catch(e) { setResult({valid:false,message:e instanceof Error?e.message:"INVALID"}); }
 }
 return <section className="page narrow"><p className="eyebrow">PUBLIC VERIFIER</p><h1>Verify a proof bundle</h1><p className="notice">The experimental single-note proof binds its note to the claim snapshot and proves standard-nullifier exclusion. The protocol is unaudited.</p><form onSubmit={submit}><label>Claim ID<input name="claimId" required pattern="[0-9a-f]{64}"/></label><label>Proof bundle (base64)<textarea name="proof" required/></label><label>Alternate nullifier(s), comma separated<input name="alternateNullifiers" required/></label><button className="button primary">Verify</button></form>{result&&<><p className={result.valid?"success":"error"} role="status">{result.valid?"VALID":result.message??"INVALID"}</p>{result.valid&&result.statement&&<dl className="claim-facts"><div><dt>AssetId</dt><dd>{result.statement.assetId}</dd></div><div><dt>Threshold</dt><dd>{result.statement.threshold}</dd></div><div><dt>Snapshot</dt><dd>{result.statement.snapshotHeight}</dd></div><div><dt>Protocol version</dt><dd>{result.statement.protocolVersion}</dd></div></dl>}</>}</section>;
}
