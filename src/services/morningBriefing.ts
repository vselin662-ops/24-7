import { sqliteDb } from '../../db';

export function startMorningScheduler(sendText: (chatId: number, text: string) => Promise<void>, sendVoice: (chatId: number, text: string) => Promise<void>) {
  setInterval(async () => {
    try {
      const timeStr = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      if (timeStr !== '08:00') return;
      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
      const g = global as any; if (g['briefing_' + dateStr]) return; g['briefing_' + dateStr] = true;
      let subs: any[] = []; try { subs = sqliteDb.prepare('SELECT chat_id FROM users WHERE greeted = 1').all(); } catch { return; }
      for (const s of subs) {
        const chatId = parseInt(String(s.chat_id).replace(/\D/g, ''), 10); if (isNaN(chatId)) continue;
        let weather = ''; try { const w = await fetch('https://wttr.in/Moscow?format=%t+%C', { signal: AbortSignal.timeout(8000) }); if (w.ok) weather = (await w.text()).trim(); } catch {}
        const text = 'Доброе утро! Сегодня в Москве: ' + (weather || 'погоду уточню позже') + '. Продуктивного дня! Ваш Selin AI.';
        await sendText(chatId, text); try { await sendVoice(chatId, text); } catch {}
      }
    } catch (e) {}
  }, 30000);
}
