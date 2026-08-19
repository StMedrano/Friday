FROM node:22-alpine
WORKDIR /app
COPY config.mjs docker.mjs server.mjs ./
ENV NODE_ENV=production
EXPOSE 3199
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:3199/health >/dev/null 2>&1 || exit 1
CMD ["node", "server.mjs"]
