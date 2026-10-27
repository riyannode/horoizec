import type { NextConfig } from "next";

const apiOrigin = process.env.HOROI_API_ORIGIN ?? "http://127.0.0.1:8787";
const demoApiOrigin = process.env.HOROI_DEMO_API_ORIGIN ?? apiOrigin;

const config: NextConfig = {
  experimental: { proxyTimeout: 900_000 },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    }];
  },
  async rewrites() {
    return [
      { source: "/api/v1/demo/:path*", destination: `${demoApiOrigin}/api/v1/demo/:path*` },
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
    ];
  },
};

export default config;
