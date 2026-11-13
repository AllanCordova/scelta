FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @scelta/api... --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @scelta/domain build \
  && pnpm --filter @scelta/db build \
  && pnpm --filter @scelta/api build

# Keep the build tree. pnpm links dependencies with relative symlinks
# (apps/api/node_modules -> ../../node_modules/.pnpm). Copying only dist
# and the root node_modules breaks those links, so Node cannot find dotenv.
FROM build AS runner
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3333
CMD ["node", "dist/index.js"]
