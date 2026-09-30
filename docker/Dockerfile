FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages packages
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build
RUN pnpm --filter @wifi-planner/server deploy --prod --legacy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_DIST=/app/web
WORKDIR /app/server
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist /app/web
VOLUME /data
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
