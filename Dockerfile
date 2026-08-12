# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=emisell-npm-build,target=/root/.npm npm ci

FROM dependencies AS build
COPY tsconfig*.json vite.config.ts eslint.config.js index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:24-alpine AS production-dependencies
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=emisell-npm-production,target=/root/.npm npm ci --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server-dist ./server-dist
COPY --from=build --chown=node:node /app/server/migrations ./server-dist/migrations

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server-dist/index.js"]
