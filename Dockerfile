FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN npm ci
COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/api/src packages/api/src
COPY packages/api/tsconfig.json packages/api/tsconfig.json
RUN npm run build --workspace @clqn/shared && npm run build --workspace @clqn/api
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/api/package.json ./packages/api/package.json
COPY --from=build --chown=node:node /app/packages/api/dist ./packages/api/dist
COPY --chown=node:node packages/api/drizzle ./packages/api/drizzle
USER node
EXPOSE 8080
CMD ["node", "packages/api/dist/index.js"]
