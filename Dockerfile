# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (e.g. better-sqlite3) and ffmpeg
RUN apk add --no-cache python3 make g++ ffmpeg

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

LABEL version="2.1.0"
LABEL description="SELIN Enterprise AI Core SaaS Server"

WORKDIR /app

# Install ffmpeg and runtime libraries
RUN apk add --no-cache ffmpeg curl

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/index.html ./dist/index.html

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.cjs"]
