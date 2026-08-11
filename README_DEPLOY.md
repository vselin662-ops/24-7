# SELIN Server - Deployment Guide

This guide describes how to deploy the SELIN full-stack server using Docker, GitHub Actions CI/CD, or manual deployment.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (optional, for containerized deployments)
- FFmpeg (for voice processing APIs)

## Environment Variables

Copy `.env.example` to `.env` and set the required secrets:

```env
JWT_SECRET=your-secure-jwt-secret
GEMINI_API_KEY=your-gemini-api-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
PORT=3000
```

## Local Development & Testing

```bash
# Install dependencies
npm ci

# Run security & unit tests
npm test

# Run linter
npm run lint

# Start dev server
npm run dev
```

## Docker Build & Run

```bash
# Build Docker image
docker build -t selin-server .

# Run container
docker run -d -p 3000:3000 \
  -e JWT_SECRET="your-jwt-secret" \
  -e GEMINI_API_KEY="your-gemini-key" \
  --name selin-app \
  selin-server
```

## CI/CD Pipeline

The repository includes a GitHub Actions workflow `.github/workflows/deploy.yml` with three automated stages:
1. **test**: Runs linter (`npm run lint`) and unit/security test suite (`npm test`).
2. **build**: Compiles the Node/Vite bundle and verifies Docker image creation.
3. **deploy**: Deploys the service securely using GitHub Secrets for sensitive environment variables (`JWT_SECRET`, `GEMINI_API_KEY`, etc.).
