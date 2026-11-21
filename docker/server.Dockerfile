# apps/server: TypeScript API compiled to CommonJS. Applies DB migrations on start.
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/server -w packages/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w apps/server && npm prune --omit=dev -w apps/server -w packages/shared

FROM node:24-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/server/package.json apps/server/
COPY --from=build /repo/apps/server/prisma apps/server/prisma
COPY --from=build /repo/apps/server/dist apps/server/dist
WORKDIR /repo/apps/server
USER node
EXPOSE 4000
CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy && exec node dist/server.js"]
