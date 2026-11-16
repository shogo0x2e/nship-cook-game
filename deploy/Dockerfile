# syntax=docker/dockerfile:1
# Official Node 26 multi-platform manifest checked on 2026-11-16.
ARG NODE_IMAGE=node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
COPY tests ./tests
COPY scripts/setup-pose.mjs ./scripts/setup-pose.mjs
RUN npm run setup:pose && npm run build

FROM ${NODE_IMAGE} AS runtime
ARG APP_REVISION=development
ENV APP_REVISION=${APP_REVISION}
LABEL org.opencontainers.image.source="https://github.com/shogo0x2e/nship-cook-game" \
      org.opencontainers.image.revision="${APP_REVISION}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
# The server imports TypeScript shared/content/game modules at runtime.
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src ./src
COPY --chown=node:node scripts/reset-password.mjs ./scripts/reset-password.mjs
USER node
EXPOSE 8787
CMD ["node", "server/server.ts"]
