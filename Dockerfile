FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git
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
