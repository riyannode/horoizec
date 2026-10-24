import type { NextConfig } from "next";
const apiOrigin = process.env.HOROI_API_ORIGIN ?? "http://127.0.0.1:8787";
const config: NextConfig = {
  async rewrites() { return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }]; }
};
export default config;
