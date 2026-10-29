FROM node:22-alpine
WORKDIR /app
COPY --chown=10001:10001 server/adapters/web-growth-schema.mjs ./server/adapters/web-growth-schema.mjs
COPY --chown=10001:10001 integrations/web-growth-reader/server.mjs ./integrations/web-growth-reader/server.mjs
USER 10001:10001
EXPOSE 4318
CMD ["node", "integrations/web-growth-reader/server.mjs"]
