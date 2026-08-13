# Selin AI

> Автономный интеллект. Учит, помогает, управляет.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://docker.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()

## Что это

Selin AI — enterprise-grade автономный AI-сотрудник для бизнеса. Не чат-бот, а цифровой офис: мультиагентная система с голосом, памятью, базой знаний и подключением к внешним сервисам через MCP.

## Возможности

- 🧠 Мультиагентный оркестратор (Gemini 2.5)
- 🎤 Голосовой ввод/вывод (TTS + STT)
- 📚 RAG — база знаний из документов (PDF, DOCX)
- 💬 Интеграция с Max Messenger
- 📋 SMART-планировщик задач
- 🔌 MCP — подключение внешних сервисов
- 🛡️ Enterprise безопасность (JWT, Rate Limiting, Zod)
- 🐳 Docker-ready, CI/CD через GitHub Actions

## Архитектура

```text
               ┌───────────────────────────────────────────────┐
               │              Клиентский интерфейс            │
               │   (React 18 + Tailwind + Voice Input)        │
               └───────────────────────┬───────────────────────┘
                                       │
                                       ▼
               ┌───────────────────────────────────────────────┐
               │            API Server (Express / Node.js)     │
               │        (JWT Auth / Rate Limiters / Zod)       │
               └───────────────────────┬───────────────────────┘
                                       │
                ┌──────────────────────┼──────────────────────┐
                ▼                      ▼                      ▼
    ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐
    │  Intent & Emotion    ││  Multi-Agent Engine  ││    Knowledge RAG     │
    │  Engine (Gemini 2.5) ││ (Staff, SMM, Sales)  ││ (PDF, DOCX, Search)  │
    └──────────────────────┘└──────────────────────┘└──────────────────────┘
                │                      │                      │
                └──────────────────────┼──────────────────────┘
                                       ▼
               ┌───────────────────────────────────────────────┐
               │          SQLite Storage & Vector DB           │
               └───────────────────────────────────────────────┘
```

## Быстрый старт

### Требования
- Node.js 20+
- FFmpeg (для голосовых функций)
- Docker (опционально)

### Локальный запуск

```bash
# Клонировать
git clone https://github.com/vselin662-ops/24-7.git
cd 24-7

# Зависимости
npm install

# Переменные окружения
cp .env.example .env
# Заполни GEMINI_API_KEY, MAX_BOT_TOKEN, JWT_SECRET

# Запуск
npm run dev
```

### Docker

```bash
docker build -t selin-ai .
docker run -d -p 3000:3000 --env-file .env selin-ai
```

## API Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /api/enterprise/process | Главный AI-процессор |
| POST | /api/knowledge/upload | Загрузка в базу знаний |
| POST | /api/smart-plan | Генерация SMART-плана |
| POST | /api/mcp/execute | Выполнение MCP команды |
| GET  | /api/health | Health check |

## Переменные окружения

| Переменная | Обязательна | Описание |
|-----------|------------|----------|
| GEMINI_API_KEY | ✅ | API ключ Google Gemini |
| MAX_BOT_TOKEN | ✅ | Токен бота Max Messenger |
| JWT_SECRET | ✅ | Секрет для подписи токенов |
| PORT | ❌ | Порт сервера (по умолчанию 3000) |

## Стек

- **Runtime:** Node.js 20+, TypeScript 5.8
- **Framework:** Express.js
- **AI:** Google Gemini 2.5 (@google/genai)
- **Frontend:** React 19, Vite 6, Tailwind CSS 4
- **Database:** SQLite (локальная), Firebase Admin (опционально)
- **Protocol:** MCP (Model Context Protocol)
- **Security:** JWT, express-rate-limit, Zod validation
- **Deploy:** Docker, GitHub Actions CI/CD

## Лицензия

Proprietary — Selin AI © 2026
