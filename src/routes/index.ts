/**
 * Selin AI 2.0 Routes Module
 * Экспорт маршрутов API:
 * - language.routes: Эндпоинты языкового обучения и трекинга прогресса
 * - security.routes: Эндпоинты аудита безопасности и мониторинга
 */

import languageRouter from './language.routes';
import securityRouter from './security.routes';

export {
  languageRouter,
  securityRouter
};

export * from './language.routes';
export * from './security.routes';
