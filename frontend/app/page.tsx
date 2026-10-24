import Link from "next/link";
export default function Home() {
 return <section className="hero"><p className="eyebrow">PRIVATE ASSETS NEED PRIVATE COMPOSABILITY</p><h1>Snapshot statements<br/><span>for shielded assets.</span></h1><p className="intro">Experimental single-note proofs scan and prove locally from public OrchardZSA chain data.</p><div className="actions"><Link className="button primary" href="/claims">Browse Claims</Link><Link className="button" href="/create">Create Statement</Link></div><div className="privacy"><div><h2>PUBLIC</h2><p>Asset | Threshold | Snapshot | Proof result</p></div><div><h2>PRIVATE</h2><p>Exact balance | Wallet | Notes | History</p></div></div></section>;
}
