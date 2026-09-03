# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (e.g. better-sqlite3), ffmpeg, and CA certificates
RUN apk add --no-cache python3 make g++ ffmpeg ca-certificates && update-ca-certificates

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

LABEL version="2.1.0"
LABEL description="SELIN Enterprise AI Core SaaS Server"

WORKDIR /app

# Install ffmpeg, curl, and CA certificates for secure TLS trust stores
RUN apk add --no-cache ffmpeg curl ca-certificates && update-ca-certificates

ENV NODE_ENV=production
ENV PORT=3000

# Create data directory and ensure ownership by the 'node' user
RUN mkdir -p /app/data && chown -R node:node /app

COPY --chown=node:node package.json ./
RUN npm install --only=production

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/index.html ./dist/index.html
COPY --chown=node:node data ./data

# Switch to unprivileged user
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.cjs"]
