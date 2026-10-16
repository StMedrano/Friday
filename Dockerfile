# Pin the Node/Alpine patch release for repeatable releases.
FROM node:22.23.2-alpine3.23 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22.23.2-alpine3.23 AS runtime
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp
# UID/GID 10001 own new data volumes; existing root-owned data needs a
# backed-up, separately approved ownership migration before rollout.
RUN addgroup -S -g 10001 friday && adduser -S -D -H -u 10001 -G friday friday && mkdir -p /data /tmp && chown 10001:10001 /data /tmp
# Runtime uses the Node binary only. The base image's bundled npm toolchain
# is not used to serve Friday and carries high/critical advisories.
# Keep npm in the separate build stage for reproducible package installation.
RUN apk upgrade --no-cache \
    && apk add --no-cache git \
    && rm -rf /usr/local/lib/node_modules \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && rm -rf /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/agents ./agents
# Reviewed Phase 2C catalogs are metadata/SOPs only, not secrets.
COPY --from=build /app/groups ./groups
COPY --from=build /app/skills ./skills
COPY --from=build /app/plugin-catalog ./plugin-catalog
COPY --from=build /app/agent-assignments ./agent-assignments
COPY --from=build /app/package.json ./package.json
USER 10001:10001
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3010/healthz >/dev/null 2>&1 || exit 1
CMD ["node", "server/index.mjs"]
