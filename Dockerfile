# Kollaudo server with its web UI. Build from the repository root:
#   docker build -t kollaudo .

FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kollaudo/server... --filter @kollaudo/web build
# The server with its production dependencies only, and its migrations.
RUN pnpm --filter @kollaudo/server deploy --prod /app/server
RUN chmod +x /app/server/dist/main.js

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    KOLLAUDO_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /app/server /app/server
COPY --from=build /src/apps/web/dist /app/web
RUN ln -s /app/server/dist/main.js /usr/local/bin/kollaudo-server
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD wget -q -O /dev/null http://localhost:8080/healthz || exit 1
ENTRYPOINT ["kollaudo-server"]
