import type { IntelligenceModule, ActionResult } from '../base-module';
import type { Intent } from '../../core/intent-engine';
import type { Memory } from '../../core/memory';

export class ServicesModule implements IntelligenceModule {
  name = 'services';

  async processIntent(intent: Intent, _memory: Memory): Promise<ActionResult> {
    const serviceName = intent.type.replace('order_', '').replace('_', ' ');
    return {
      text: `🚕 [Selin AI Services] Запрос на услугу (${serviceName}): "${intent.raw_text}".\nЯ подтверждаю бронирование/заказ. В коммерческом режиме здесь подключается API провайдера.`,
    };
  }

  getCapabilities(): string[] {
    return ['Заказ такси', 'Заказ еды и напитков', 'Бронирование отелей', 'Поиск авиабилетов', 'Запрос сервиса'];
  }
}

export const servicesModule = new ServicesModule();
