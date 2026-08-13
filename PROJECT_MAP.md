# 🗺️ SELIN AI — Полная Карта Проекта и Архитектуры

> **Дата обновления**: 13 Августа 2026 г.  
> **Версия системы**: 1.0.0 Enterprise Ready  
> **Основной стек**: Node.js + Express, TypeScript, Vite, React 18, Tailwind CSS, Google Gemini 2.0 Flash API, Pure SQLite (WAL mode).

---

## 1. 🏗️ Общая Архитектура Проекта

```
               ┌──────────────────────────────────────────────┐
               │         React 18 Frontend (Vite)             │
               │  - VoiceButton (4 состояния)                 │
               │  - Module Panels (Language, Business, etc.)  │
               │  - Custom Hooks (useVoiceRecorder)           │
               └──────────────────────┬───────────────────────┘
                                      │ HTTP / REST / WebSockets
               ┌──────────────────────▼───────────────────────┐
               │            Express Server (server.ts)        │
               │  - Request ID & Auth Middleware             │
               │  - Rate Limiting & Security Shield           │
               └──────────┬───────────────────────┬───────────┘
                          │                       │
      ┌───────────────────▼───┐               ┌───▼──────────────────┐
      │  AI Security Shield   │               │   AI & Integrations  │
      │  - Prompt Injection   │               │   - Google Gemini API│
      │  - RAG Protection     │               │   - MCP Server/Tools │
      │  - MCP Guardian       │               │   - Max Bot / Telegram│
      │  - Output Filter      │               │   - TTS & Audio STT  │
      │  - Trust Engine       │               └──────────────────────┘
      │  - Jailbreak Detector │
      └───────────────────────┘
```

---

## 2. 📂 Карта Файлов и Структура Проекта

### ── ⚙️ Корень Проекта
* `server.ts` — Главный серверный точка входа Express (API routes, Gemini, MCP, TTS, Voice Transcribe, SSE).
* `db.ts` — Модуль работы с базы данных Pure SQLite (поддержка WAL mode, изоляция тенантов).
* `package.json` — Зависимости, скрипты (`dev`, `build`, `start`, `test`, `lint`), переопределения (overrides).
* `vite.config.ts` — Конфигурация сборщика Vite для фронтенда.
* `tsconfig.json` — Настройки компилятора TypeScript (strict mode, ES2022).
* `index.html` — HTML шапка и точка монтирования SPA приложения.
* `Dockerfile` & `.dockerignore` — Контейнеризация приложения для Cloud Run.

---

### ── 🛡️ Система Безопасности AI (`src/services/` & `src/middleware/`)
Система защиты соответствует **OWASP Top 10 for LLM 2026**:

* **`src/middleware/ai-shield.ts`** — Защита от Prompt Injection (`sanitizePromptInput`), отсечение zero-width символов (`U+200B..U+FEFF`), нормализация NFKC.
* **`src/services/rag-protection.ts`** — Защита от косвенных инъекций (Indirect Injection) в база знаний RAG (`sanitizeRAGChunk`), изоляция данных в теги `<retrieved_document>`.
* **`src/services/mcp-guardian.ts`** — Проверка целостности MCP инструментов (SHA-256 хеширование схем), валидация whitelists и песочница вызовов.
* **`src/services/output-filter.ts`** — Мониторинг ответов AI на утечки API-ключей, JWT, приваных ключей, Canary-токенов (`sanitizeAIOutput`).
* **`src/services/agent-monitor.ts`** — Контроль радиуса поражения агента (лимиты на вызовы инструментов и токены).
* **`src/services/jailbreak-detector.ts`** — Детекция 50+ известных шаблонов хакинга (DAN, Developer Mode и др.).
* **`src/services/trust-engine.ts`** — Динамический рейтинг доверия пользователей (Multi-Turn Trust Score 0..100).
* **`src/services/canary-tokens.ts`** — Инъекция и проверка Canary-токенов для мгновенного обнаружения exfiltration.
* **`src/routes/security.routes.ts`** — Управление киллсвитчем (`POST /api/security/killswitch`) и аудит безопасности.

---

### ── 🎙️ Голосовой Движок & Хуки (`src/hooks/` & `src/components/`)
* **`src/hooks/useVoiceRecorder.ts`** — Хук работы с микрофоном браузера:
  * Запрос `navigator.mediaDevices.getUserMedia`.
  * Анализатор громкости в реальном времени (`AudioContext` + `AnalyserNode`).
  * Сбор чанков через `MediaRecorder` (`audio/webm;codecs=opus`).
  * Автоматический таймер, лимит 60 сек, защита от случайных нажатий (<1 сек).
  * ОтправкаFormData на `POST /api/voice/transcribe`.
* **`src/components/VoiceButton.tsx`** — Главный элемент управления голосом (64x64px):
  * **`idle`**: Золотой градиент Selin (`#C5A059` -> `#8C6F38`), иконка микрофона, мягкая пульсация тени.
  * **`recording`**: Красный градиент, расходящиеся волны (ripple), анимация пульсации, таймер `0:05`.
  * **`processing`**: Фиолетовый градиент, вращающийся ring, 3 подпрыгивающие точки.
  * **`speaking`**: Зеленый градиент, пульсирующие эквалайзер-дуги, масштабирование под громкость `volume`.
  * **Позиция**: `fixed bottom-[90px] left-1/2 -translate-x-1/2 z-[1000]`.

---

### ── 🧩 Модули Ассистента (`src/modules/`)
* **`base-module.ts`** — Базовый интерфейс и класс для всех модулей Selin AI.
* **`language-tutor.ts`** / **`language/`** — Обучение языкам (грамматика, тренажер слов, диалоги).
* **`business/`** — Бизнес-аналитика, расчеты, стратегия.
* **`content/`** — Генерация контента, постов, копирайтинг.
* **`finance/`** — Управление финансами и бюджетом.
* **`health/`** — Трэкер здоровья и рекомендаций.
* **`knowledge/`** — Интеграция с базой знаний и RAG.
* **`entertainment/`**, **`robot/`**, **`services/`**, **`social/`** — Дополнительные специализированные модули.

---

### ── 🎨 Интерфейсы & UI Компоненты (`src/components/`)
* **`App.tsx`** — Главная страница и менеджер вкладок SPA (Главная, Языки, Бизнес, Лайфстайл, Лента, Модерация, База знаний, Настройки).
* **`OnboardingFlow.tsx`** & **`VoiceOrganismOnboarding.tsx`** — Пошаговый онбординг пользователя.
* **`SMARTPlanner.tsx`** — Планировщик целей по методологии SMART.
* **`KnowledgeBasePanel.tsx`** — Загрузка и управление документами базы знаний (PDF, TXT, DOCX).
* **`MCPToolsPanel.tsx`** — Панель управления и проверки статуса MCP инструментов.
* **`AnalyticsPanel.tsx`** — Метрики использования, токены, доверие и активность.
* **`ModerationPanel.tsx`** — Панель модерации и аудита безопасности.
* **`StaffFeed.tsx`** — Лента обновлений и сообщений.
* **`SettingsPanel.tsx`** — Настройки голоса (TTS), токенов, ключей и профиля.
* **`FAQPanel.tsx`** — Ответы на частые вопросы.
* **`LaunchModal.tsx`** — Модальное окно запуска проектов.
* **`GlassPanel.tsx`** & **`NeonButton.tsx`** — Базовые стили UI с эффектом стекла и неонового свечения.

---

### ── 📑 Реестр Эндпоинтов API (`server.ts`)

#### 🎙️ Голос и Распознавание:
* `POST /api/voice/transcribe` — Распознавание аудио через Gemini 2.0 Flash (`multipart/form-data`).
* `POST /api/tts` & `POST /api/synthesize` — Синтез речи (Text-to-Speech) с выбором голоса.
* `POST /api/voice-organism-dialogue` — Интерактивный голосовой диалог.

#### 💬 Чат и AI Движок:
* `POST /api/chats/message` — Отправка сообщения AI ассистенту с поддержкой контекста.
* `POST /api/agent-respond` — Прямой ответ агента с вызовом MCP инструментов.

#### 🛡️ Безопасность и Аудит:
* `POST /api/security/killswitch` — Аварийная остановка системы (Emergency Killswitch).
* `GET /api/security/audit` — Логи безопасности и инцидентов.
* `GET /api/security/trust` — Получение рейтинга доверия тенанта.

#### 📚 База Знаний и RAG:
* `POST /api/knowledge/upload` — Загрузка документов в базу знаний.
* `POST /api/knowledge/delete` — Удаление документов.
* `GET /api/knowledge/docs` — Список загруженных документов.

#### 🛠️ MCP Инструменты:
* `POST /api/mcp/execute` — Безопасное исполнение MCP инструмента через песочницу.
* `GET /api/mcp/tools` — Список зарегистрированных MCP инструментов и их хешей.

#### 📊 Планирование и Квесты:
* `POST /api/smart-plan` — Генерация SMART планов.
* `POST /api/smart-interview/next` — Шаги интерактивного интервью.

---

## 3. 🧪 Тестирование и Валидация

* **`tests/security.test.ts`** — Полный набор автоматических тестов безопасности (10/10 пройдены):
  1. Safe Math Evaluation.
  2. Auth Middleware.
  3. Rate Limiter.
  4. SQLite Tenant Isolation.
  5. OWASP LLM 1: Prompt Injection.
  6. OWASP LLM 2: Indirect Injection & RAG.
  7. OWASP LLM 3: MCP Tool Poisoning Guardian.
  8. OWASP LLM 4: Output Filtering & Exfiltration.
  9. OWASP LLM 6: Jailbreak Detection.
  10. Multi-Turn Trust Engine & Canary Tokens.
* **`tests/connectors.test.ts`** — Тесты коннекторов сторонних сервисов.

---
*Документ автоматически сгенерирован для Selin AI.*
