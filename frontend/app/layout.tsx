import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Horoi - private ZSA ownership claims", description: "Verify private ZSA ownership claims against immutable snapshot statements." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="en"><body><header className="nav"><Link className="wordmark" href="/">HOROI</Link><nav><Link href="/demo">Demo</Link><Link href="/claims">Claims</Link><Link href="/create">Create</Link><Link href="/verify">Verify</Link></nav></header><main>{children}</main><footer>Experimental protocol | Unaudited | Do not use real funds</footer></body></html>;
}
