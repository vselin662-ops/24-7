/**
 * Selin AI 2.0 Core Module
 * Экспорт основных компонентов ядра системы:
 * - SelinCore: Главное ядро управления и маршрутизации
 * - LLMService: Единый фасад для взаимодействия с языковыми моделями
 * - MemorySystem: Краткосрочная, долгосрочная память, RAG и Spaced Repetition (Pensyve)
 * - Multi-agent Orchestrator: Координатор агентов и адаптеров
 * - Engines: Интенты, принятие решений, планирование и эмоции
 */

export * from './types';
export * from './LLMService';
export * from './SelinCore';
export * from './orchestrator';
export * from './intent-engine';
export * from './decision-engine';
export * from './emotion-engine';
export * from './planner';
export * from './MemorySystem';
export * from './AgentOrchestrator';
export * from './CacheService';

export {
  type Message as LegacyMessage,
  type MemoryFragment,
  type LongTermMemory,
  type Memory,
  memorySystem as legacyMemorySystem
} from './memory';
