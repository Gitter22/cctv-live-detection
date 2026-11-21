# apps/server: TypeScript API compiled to CommonJS.
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/server -w packages/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --if-present -w packages/shared && npm run build -w apps/server

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/server -w packages/shared --omit=dev && npm cache clean --force
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/server/dist apps/server/dist
WORKDIR /repo/apps/server
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
