# syntax=docker/dockerfile:1

# Build from the REPO ROOT, not this directory:
#   docker build -f packages/oracle-backend/Dockerfile -t oracle-backend .
# The backend depends on @signal/dreamdex-integration, a sibling workspace, so
# the build context has to include it.

# ---------------------------------------------------------------- deps
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only manifests first so this layer caches across source edits.
COPY package.json package-lock.json ./
COPY packages/dreamdex-integration/package.json ./packages/dreamdex-integration/
COPY packages/oracle-backend/package.json ./packages/oracle-backend/

# The frontend is a separate deployable; omitting it keeps this image small.
# --ignore-scripts: no dependency should run arbitrary code at build time.
RUN npm ci --ignore-scripts --workspace=@signal/oracle-backend --include-workspace-root

# ---------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY packages/dreamdex-integration ./packages/dreamdex-integration
COPY packages/oracle-backend ./packages/oracle-backend
# The backend imports @signal/dreamdex-integration, which ships compiled JS -
# so it has to be built first, not just present as source.
RUN npm run build --workspace=@signal/dreamdex-integration \n && npm run build --workspace=@signal/oracle-backend

# ---------------------------------------------------------------- prod deps
# A second, dev-free install. The build needs typescript and tsx; the runtime
# must not ship them.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/dreamdex-integration/package.json ./packages/dreamdex-integration/
COPY packages/oracle-backend/package.json ./packages/oracle-backend/
RUN npm ci --omit=dev --ignore-scripts       --workspace=@signal/oracle-backend --include-workspace-root

# ---------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# pino-pretty is only loaded outside production, but NODE_ENV must be set
# explicitly for that to hold - an unset NODE_ENV would try to load it.

RUN apk add --no-cache tini

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/dreamdex-integration/package.json ./packages/dreamdex-integration/
COPY --from=build /app/packages/dreamdex-integration/dist ./packages/dreamdex-integration/dist
COPY --from=build /app/packages/oracle-backend/package.json ./packages/oracle-backend/
COPY --from=build /app/packages/oracle-backend/dist ./packages/oracle-backend/dist
# Migrations are SQL files read at runtime by db:migrate, not compiled in.
COPY --from=build /app/packages/oracle-backend/drizzle ./packages/oracle-backend/drizzle

WORKDIR /app/packages/oracle-backend

# Never run as root.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards signals, so the server's graceful shutdown
# actually runs on `docker stop` instead of being SIGKILLed.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

# Migrations are a separate step, not part of boot - two replicas starting at
# once must not race each other through the same migration:
#   docker run --rm --env-file .env <image> npm run db:migrate:prod
