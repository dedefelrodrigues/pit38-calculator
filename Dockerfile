# --- Builder -----------------------------------------------------------
FROM node:20-alpine AS builder

RUN npm install -g pnpm@10

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/tax-engine/package.json packages/tax-engine/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY packages/tax-engine packages/tax-engine
COPY apps/web apps/web

RUN pnpm --filter web build

# --- Runtime -------------------------------------------------------------
FROM nginx:alpine AS runtime

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
