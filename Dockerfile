# syntax=docker/dockerfile:1

# CytoHub CEO Command Center production image. The same image serves the app,
# runs the ingestion worker and the scheduled jobs (migrations, the morning
# refresh, first-time setup), so it keeps the full dependency tree, including
# the TypeScript runner those scripts use. See deploy/lightsail/README.md.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma's migration engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
# The install step generates the Prisma client, so it needs the schema first.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && rm -rf .next/cache

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
# Application files stay root-owned (read-only to the app); only the Next.js
# cache is writable by the unprivileged user.
COPY --from=build /app ./
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
CMD ["sh", "scripts/docker/start.sh"]
