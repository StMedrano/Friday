FROM node:22.23.2-alpine3.23
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S -g 10001 friday \
    && adduser -S -D -H -u 10001 -G friday friday
COPY --chown=10001:10001 config.mjs docker.mjs server.mjs ./
USER 10001:10001
EXPOSE 3199
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:3199/health >/dev/null 2>&1 || exit 1
CMD ["node", "server.mjs"]
