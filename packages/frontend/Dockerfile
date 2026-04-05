FROM node:20-alpine AS builder

RUN npm install -g bun

WORKDIR /app

COPY package.json ./
COPY packages/shared ./packages/shared/
COPY packages/frontend ./packages/frontend/

RUN cd packages/frontend && bun install
RUN cd packages/frontend && bun run build

# --- Runtime: nginx serves static + reverse proxies API to backend ---
FROM nginx:alpine

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
