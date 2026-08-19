/**
 * Selin AI 2.0 Adapters Module
 * Экспорт всех адаптеров каналов связи:
 * - base.adapter: Базовые интерфейсы событий и адаптеров
 * - MaxAdapter: Основной адаптер для MAX Messenger
 * - LegacyMaxAdapter: Сохранённый адаптер для обратной совместимости
 * - TelegramAdapter: Адаптер для Telegram Bot API
 * - WebAdapter: Адаптер для Web UI и WebSocket
 * - RobotAdapter: Адаптер для интеграции с робототехническими платформами
 */

export * from './base.adapter';
export * from './MaxAdapter';
export { MaxAdapter as LegacyMaxAdapter } from './max.adapter';
export * from './telegram.adapter';
export * from './web.adapter';
export * from './robot.adapter';
