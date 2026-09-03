import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { isOwner } from "../fintech/subscriptions";
import {
  getUserPlanConfig,
  updateUserPlanConfig
} from "./ProfileService";
import {
  biblePendingConfirmations,
  getNearestPlanSlotTime,
  sendImmediatePlanPobedyVerse,
  getPlanDaySummary,
  getPlanContentsSummary,
  skipUserPlanDays,
  sendPlanSlotToUser
} from "./bibleService";

export async function handleBibleSubscription(
  chatId: string | number,
  text: string,
  isVoice: boolean = false
): Promise<string | null> {
  if (!text) return null;
  const cleanId = String(chatId).replace(/^[a-z_]+/, '');
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const now = Date.now();

  const pendingTimestamp = biblePendingConfirmations.get(cleanId);
  if (pendingTimestamp) {
    if (now - pendingTimestamp <= 5 * 60 * 1000) {
      if (lower === 'да' || lower.startsWith('да ') || lower.startsWith('да,') || lower.startsWith('да.')) {
        biblePendingConfirmations.delete(cleanId);
        updateUserPlanConfig(cleanId, { plan_enabled: 1, plan_status: 'on_buttons' });
        try {
          sqliteDb?.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)")
            .run(cleanId, new Date().toISOString().slice(0, 10), 1, 365);
        } catch {}

        sendImmediatePlanPobedyVerse(cleanId).catch(() => {});
        return '✅ План Победы включён! Отправляю стих дня голосом. Приятного прослушивания!';
      }

      if (lower === 'нет' || lower.startsWith('нет ') || lower.startsWith('нет,') || lower.startsWith('нет.')) {
        biblePendingConfirmations.delete(cleanId);
        return 'Хорошо, не подключаю. Если передумаешь — просто скажи команду.';
      }
    } else {
      biblePendingConfirmations.delete(cleanId);
    }
  }

  // === СЕКРЕТНАЯ ТЕСТОВАЯ КОМАНДА "МАИСЕЙ" ===
  if (lower === 'маисей') {
    if (!isOwner(cleanId)) {
      logger.warn(`⚠️ [Security] Unauthorized user ${cleanId} attempted secret command 'Маисей'`);
      return null; // Игнорируем не-владельцев
    }

    logger.info(`✨ [Moisey] Owner ${cleanId} triggered forced Victory Plan test.`);

    try {
      const { buildSlotContent } = await import("./PlanContentBuilder");
      const { modernMaxAdapter } = await import("../../server");

      // Определяем текущий временной слот в зависимости от текущего часа по Московскому времени
      const nowTime = new Date();
      const hour = parseInt(new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(nowTime), 10);
      let slotKey: 'morning' | 'noon' | 'evening' = 'morning';
      if (hour >= 12 && hour < 18) slotKey = 'noon';
      else if (hour >= 18) slotKey = 'evening';

      const content = await buildSlotContent(cleanId, slotKey);

      // Отправляем красивый текст
      await modernMaxAdapter.sendToUser(cleanId, content.text);
      // И аудио голосом
      await modernMaxAdapter.sendVoice(cleanId, content.voiceText);

      return "✅ Тест Маисей выполнен. Проверьте сообщения и голосовую версию.";
    } catch (err: any) {
      logger.error(`❌ [Moisey] Error during forced test delivery:`, err);
      return `❌ Ошибка выполнения теста Маисей: ${err?.message || err}`;
    }
  }

  // === ЗАДАЧА 3: Текстовые команды ===
  if (lower === 'включить план победы' || lower === 'включить план' || lower === 'plan_on' || lower === '/plan_on') {
    updateUserPlanConfig(cleanId, { plan_enabled: 1, plan_status: 'on_buttons' });
    try {
      sqliteDb?.prepare("INSERT OR REPLACE INTO bible_subs (chat_id, start_date, active, period_days) VALUES (?, ?, ?, ?)")
        .run(cleanId, new Date().toISOString().slice(0, 10), 1, 365);
    } catch {}
    sendImmediatePlanPobedyVerse(cleanId).catch(() => {});
    return '✅ План Победы включён! Отправляю стих дня голосом. Приятного прослушивания!';
  }

  if (lower === 'отключить план победы' || lower === 'выключить план победы' || lower === 'stop_plan' || lower === 'plan_off' || lower === '/plan_off') {
    updateUserPlanConfig(cleanId, { plan_enabled: 0, plan_status: 'off' });
    try {
      sqliteDb?.prepare("UPDATE bible_subs SET active = 0 WHERE chat_id = ?").run(cleanId);
    } catch {}
    return '❌ План Победы выключен.';
  }

  if (lower === 'настройки план победы' || lower === 'настройки плана победы' || lower === 'план победы настройки') {
    try {
      const { renderPlanMenu } = await import("./CallbackRouter");
      const menu = renderPlanMenu(cleanId);
      const { modernMaxAdapter } = await import("../../server");
      await modernMaxAdapter.safeSendMessageToChat(cleanId, menu.text, menu.extra);
      return "[HANDLED_WITH_BUTTONS]";
    } catch (err) {
      logger.error(`❌ Error rendering plan settings menu:`, err);
      return "⚠️ Не удалось открыть меню настроек.";
    }
  }

  // === КОМАНДА 1: 'план на сегодня' ===
  if (
    lower === 'план на сегодня' ||
    lower === 'план сегодня' ||
    lower === 'план_на_сегодня' ||
    lower === '/plan_today'
  ) {
    return getPlanDaySummary(cleanId, false);
  }

  // === КОМАНДА 2: 'план на завтра' ===
  if (
    lower === 'план на завтра' ||
    lower === 'план завтра' ||
    lower === 'план_на_завтра' ||
    lower === '/plan_tomorrow'
  ) {
    return getPlanDaySummary(cleanId, true);
  }

  // === КОМАНДА 3: 'план содержание' (только OWNER) ===
  if (
    lower === 'план содержание' ||
    lower === 'план_содержание' ||
    lower === '/plan_contents' ||
    lower === '/plan_content'
  ) {
    if (isOwner(cleanId)) {
      return getPlanContentsSummary();
    }
    return null; // от не-владельца -> игнор
  }

  // === КОМАНДА 4: 'план пропустить <N дней>' (только OWNER) ===
  const skipMatch = lower.match(/^план\s+пропустить\s+(-?\d+)(?:\s+дн[еяй]|\s+дня|\s+дней)?/i) ||
    lower.match(/^\/plan_skip\s+(-?\d+)/i);
  if (skipMatch) {
    if (isOwner(cleanId)) {
      const skipDays = parseInt(skipMatch[1], 10);
      return skipUserPlanDays(cleanId, skipDays);
    }
    return null; // от не-владельца -> игнор
  }

  // === ЗАДАЧА 1: Упрощённое меню (при команде "план победы") ===
  const isPlanQuestion = lower === 'план победы' || lower === 'план_победы' || lower === '/plan';
  if (isPlanQuestion) {
    logger.info(`❓ [Intent] fn=plan chat=${cleanId}`);
    const cfg = getUserPlanConfig(cleanId);
    const isEnabled = (cfg.plan_status === 'on_buttons' || cfg.plan_status === 'on_quiet' || cfg.plan_enabled === 1) && cfg.plan_status !== 'off';
    const statusStr = isEnabled ? 'включён' : 'выключен';

    const menuText = `🕊 **План Победы**\n\nКаждый день вы будете получать духовный разбор Писания и практическую мотивацию в виде голосовых сообщений.\n\nТекущий статус: **${statusStr}**\n\nВыберите действие:`;

    const extra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                { type: 'callback', text: '✅ Включить', payload: 'plan_on' },
                { type: 'callback', text: '❌ Выключить', payload: 'plan_off' }
              ]
            ]
          }
        }
      ]
    };

    try {
      const { modernMaxAdapter } = await import("../../server");
      await modernMaxAdapter.safeSendMessageToChat(cleanId, menuText, extra);
    } catch (err) {
      logger.error(`❌ Error sending simple plan menu:`, err);
    }

    return "[HANDLED_WITH_BUTTONS]";
  }

  if (lower === 'тест рассылки' || lower === 'тест_рассылки') {
    logger.info(`📖 [Bible Test] Running manual test broadcast for chatId ${cleanId}`);
    sendPlanSlotToUser(cleanId, 'm').catch(() => {});
    return 'Запущен ручной тест: отправляю чтение Плана Победы голосом в ваш чат.';
  }

  if (lower.includes('бог благ и милость его велика')) {
    const config = getUserPlanConfig(cleanId);
    if (config.plan_enabled === 1 && config.plan_status !== 'off') {
      updateUserPlanConfig(cleanId, { plan_enabled: 0, plan_status: 'off' });
      try {
        sqliteDb?.prepare("UPDATE bible_subs SET active = 0 WHERE chat_id = ?").run(cleanId);
      } catch {}
      return '❌ План Победы выключен. Возвращайся!';
    } else {
      biblePendingConfirmations.set(cleanId, Date.now());
      return 'Команда включает План победы на год: каждый день голосовые стихи и разборы по расписанию. Это твой личный годовой план. Отключить можно той же командой. Подключаем? Ответь: да или нет.';
    }
  }

  return null;
}
