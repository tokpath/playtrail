# Build stage: Node 24 LTS, pnpm from the packageManager field.
FROM node:24-alpine3.22 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://api:8081
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm build

# Next.js standalone output.
FROM node:24-alpine3.22
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
