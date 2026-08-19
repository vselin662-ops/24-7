/**
 * Selin AI 2.0 Modules
 * Экспорт всех тематических доменных модулей:
 * - base-module: Базовый интерфейс доменного модуля
 * - language-tutor: Модуль языкового обучения
 * - business: Модуль бизнес-инструментов
 * - knowledge: Модуль базы знаний
 * - content: Модуль контент-генерации
 * - finance: Модуль учета финансов
 * - health: Модуль здоровья и привычек
 * - entertainment: Модуль досуга и рекомендаций
 * - social: Модуль социальных интеграций
 * - robot: Модуль управления робототехникой
 * - services: Модуль городских и бытовых сервисов
 */

export * from './base-module';
export * from './language-tutor';
export * as languageEngine from './language/language.module';
export * from './business';
export * from './knowledge';
export * from './content';
export * from './finance';
export * from './health';
export * from './entertainment';
export * from './social';
export * from './robot';
export * from './services';
