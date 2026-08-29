/**
 * Selin AI 2.0 Services Module
 * Экспорт всех вспомогательных сервисов и подсистем безопасности:
 * - TTSService / tts.service: Синтез речи (ElevenLabs, Gemini, Edge TTS, Google Translate)
 * - stt.service: Распознавание речи
 * - flight.service: Поиск авиабилетов и гостиниц
 * - rag-protection: Защита контекста RAG и санитизация
 * - jailbreak-detector / canary-tokens: Обнаружение атак и канареечные токены
 * - output-filter / mcp-guardian: Фильтрация ответов и валидация MCP-инструментов
 * - agent-monitor / trust-engine: Метрики, скоринг доверия и мониторинг
 * - gemini.service / max-bot.service: Интеграционные сервисы
 */

export * from './TTSService';
export * from './stt.service';
export * from './flight.service';
export * from './rag-protection';
export * from './jailbreak-detector';
export * from './canary-tokens';
export * from './output-filter';
export * from './mcp-guardian';
export * from './agent-monitor';
export * from './trust-engine';
export * from './gemini.service';
export * from './max-bot.service';
export * from './aiOrchestrator';
export * from './WebSearchService';
