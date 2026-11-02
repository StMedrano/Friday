# Pin the Node/Alpine patch release for repeatable releases.
FROM node:22.23.2-alpine3.23 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Server runtime dependencies (web-push), installed from the lockfile so the
# controller image matches the reviewed tree. npm stays in this stage only.
FROM node:22.23.2-alpine3.23 AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22.23.2-alpine3.23 AS runtime-base
WORKDIR /app
ENV NODE_ENV=production
# Runtime uses the Node binary only. The base image's bundled npm, npx,
# corepack and Yarn are not needed to serve Friday and carry advisories.
RUN apk upgrade --no-cache \
    && apk add --no-cache git \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/agents ./agents
# Immutable, reviewed Phase 2C catalogs: metadata/SOPs only, not secrets.
COPY --from=build /app/groups ./groups
COPY --from=build /app/skills ./skills
COPY --from=build /app/plugin-catalog ./plugin-catalog
COPY --from=build /app/agent-assignments ./agent-assignments
COPY --from=build /app/package.json ./package.json
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3010/healthz >/dev/null 2>&1 || exit 1
CMD ["node", "server/index.mjs"]

# Non-root candidate (UID/GID 10001). Built and rehearsed in CI only; no
# Compose file selects it until VM102's root-owned friday_data volume has been
# copied to a 10001-owned volume in an approved maintenance window.
FROM runtime-base AS runtime-nonroot
ENV HOME=/tmp
RUN addgroup -S -g 10001 friday && adduser -S -D -H -u 10001 -G friday friday \
    && mkdir -p /data && chown 10001:10001 /data
USER 10001:10001

# Default image, used by Compose today: still root because the existing
# friday_data volume is root-owned. Keep this stage last.
FROM runtime-base AS runtime
