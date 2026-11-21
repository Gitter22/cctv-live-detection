# apps/edge: edge agent (TypeScript -> CommonJS).
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/edge/package.json apps/edge/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/edge -w packages/shared --include-workspace-root --ignore-scripts
COPY packages/shared packages/shared
COPY apps/edge apps/edge
RUN npm run build -w apps/edge && npm prune --omit=dev -w apps/edge -w packages/shared

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/edge/package.json apps/edge/
COPY --from=build /repo/apps/edge/dist apps/edge/dist
# Runs as root: it shares generated files with go2rtc and vision (both root) on volumes
# that any of them may create first. Secrets in those files are written with mode 0600.
RUN mkdir -p /gen /state
WORKDIR /repo/apps/edge
CMD ["node", "dist/main.js"]
