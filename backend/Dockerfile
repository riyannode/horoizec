FROM rust:1.99.1-bookworm@sha256:48b7f435b8fc6378ce43b44f15e3a47fd8919b2825f835c39bd4bd3da50af5b8 AS rust-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential clang libclang-dev cmake pkg-config git && rm -rf /var/lib/apt/lists/*
WORKDIR /src/rust
COPY rust/ .
RUN cargo build --locked --release --bin horoi-verifier

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS bun-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM bun-deps AS bun-build
COPY . .
RUN bun run build

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS bun-prod
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS runtime
ARG HOROI_SOURCE_SHA=unknown
LABEL org.opencontainers.image.revision=$HOROI_SOURCE_SHA
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 NETWORK_ID=zebra-regtest HOROI_DEMO_MODE=true DATABASE_PATH=/data/horoi.db VERIFIER_PATH=/usr/local/bin/horoi-verifier
WORKDIR /app
COPY --from=bun-prod --chown=bun:bun /app/node_modules ./node_modules
COPY --from=bun-build --chown=bun:bun /app/dist ./dist
COPY --from=rust-build /src/rust/target/release/horoi-verifier /usr/local/bin/horoi-verifier
RUN mkdir -p /data && chown bun:bun /data && chmod 0750 /data && chmod 0755 /usr/local/bin/horoi-verifier
USER bun
EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=3s --start-period=120s --retries=12 CMD ["bun", "-e", "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "dist/server.js"]
