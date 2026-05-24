FROM node:20-alpine AS base
RUN npm install -g pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/tv-web-app/package.json ./apps/tv-web-app/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/player-core/package.json ./packages/player-core/
COPY packages/ui-core/package.json ./packages/ui-core/
COPY packages/cache-engine/package.json ./packages/cache-engine/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm run build --filter=tv-web-app

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/tv-web-app/.next/standalone ./
COPY --from=builder /app/apps/tv-web-app/.next/static ./apps/tv-web-app/.next/static
COPY --from=builder /app/apps/tv-web-app/public ./apps/tv-web-app/public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "apps/tv-web-app/server.js"]
