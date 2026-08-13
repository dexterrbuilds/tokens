FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY patches patches
COPY apps apps
COPY packages packages
RUN bun install --production --frozen-lockfile --ignore-scripts

FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/cloudrun-prices/node_modules ./apps/cloudrun-prices/node_modules
# Take packages from the deps stage, not the build context: workspace
# packages are consumed as TS source, so their own node_modules (where
# bun's isolated install puts their runtime deps, e.g. `effect`) must
# come along or imports inside packages/*/src fail to resolve at boot.
COPY --from=deps /app/packages ./packages
COPY apps/cloudrun-prices/package.json apps/cloudrun-prices/package.json
COPY apps/cloudrun-prices/src ./apps/cloudrun-prices/src
WORKDIR /app/apps/cloudrun-prices
USER bun
EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
