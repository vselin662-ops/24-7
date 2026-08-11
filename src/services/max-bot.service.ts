import { processMessage } from '../modules/language/language.module';
import { userModeRepository } from '../repositories/user-mode.repository';
import { logger } from '../logger';

/**
 * Сервис обработки входящих сообщений от Max Bot.
 */
class MaxBotService {
  /**
   * Обрабатывает сообщение пользователя от Max Bot.
   *
   * @param tenantId - Идентификатор пользователя
   * @param text - Текст сообщения
   * @param isVoice - Флаг голосового сообщения
   * @returns Ответ для отправки пользователю
   */
  async handleIncomingMessage(tenantId: string, text: string, isVoice: boolean = false): Promise<string> {
    try {
      const modeRecord = await userModeRepository.getMode(tenantId);
      if (modeRecord?.mode === 'language') {
        return await processMessage(tenantId, text, isVoice);
      }
      return '';
    } catch (err) {
      logger.error('Error handling Max Bot message', { error: err, tenantId });
      return 'Произошла ошибка при обработке сообщения.';
    }
  }
}

export const maxBotService = new MaxBotService();
