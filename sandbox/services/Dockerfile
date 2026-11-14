# Build context is the repo root (see sandbox/docker-compose.yml), so the workspace
# lockfile pins every dependency.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY sandbox/services/package.json sandbox/services/
COPY server/package.json server/
COPY web/package.json web/
COPY crew-app/ui/package.json crew-app/ui/
RUN npm ci --workspace @witching-hour/sandbox-services --include-workspace-root=false --ignore-scripts
COPY sandbox/services/tsconfig.json sandbox/services/tsconfig.build.json sandbox/services/
COPY sandbox/services/src sandbox/services/src
RUN npm run build -w @witching-hour/sandbox-services \
 && npm prune --omit=dev --workspace @witching-hour/sandbox-services --include-workspace-root=false

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/sandbox/services/dist ./dist
COPY --from=build /repo/sandbox/services/package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/main.js"]
