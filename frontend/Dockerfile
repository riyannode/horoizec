FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
COPY . .
ARG HOROI_API_ORIGIN=http://backend:8787
ARG NEXT_PUBLIC_HOROI_DEMO_MODE=true
ENV HOROI_API_ORIGIN=${HOROI_API_ORIGIN} NEXT_PUBLIC_HOROI_DEMO_MODE=${NEXT_PUBLIC_HOROI_DEMO_MODE} NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS runtime
ARG HOROI_SOURCE_SHA=unknown
LABEL org.opencontainers.image.revision=$HOROI_SOURCE_SHA
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/.next ./.next
COPY --from=builder --chown=bun:bun /app/public ./public
COPY --from=builder --chown=bun:bun /app/package.json ./package.json
USER bun
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=12 CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/demo').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
