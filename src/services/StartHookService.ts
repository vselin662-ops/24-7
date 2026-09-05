import { logger } from "../logger";

export const HOOK_TEXT = `Здравствуй! Я — Селин. Твой личный помощник.
Отвечаю голосом — печатать больше не нужно!
Закажу продукты и быстро оформлю доставку.
Найду выгодные стройматериалы для любого ремонта.
Помогу с бизнесом, найду дорогу, напомню важное!
Подписка — всего 199 рублей в месяц. Дешевле чашки кофе!
Скажи голосом, что нужно, — и начнём?`;

// Текст для голосового синтеза с комбинируемым акутом U+0301 на ударных гласных
export const VOICE_HOOK_TEXT = `Здравствуй! Я — Сели\u0301н. Твой ли\u0301чный помо\u0301щник.
Отвеча\u0301ю го\u0301лосом — печа\u0301тать бо\u0301льше не ну\u0301жно!
Закажу\u0301 проду\u0301кты и бы\u0301стро офо\u0301рмлю доста\u0301вку.
Найду\u0301 вы\u0301годные стройматериа\u0301лы для любо\u0301го ремо\u0301нта.
Помогу\u0301 с би\u0301знесом, найду\u0301 доро\u0301гу, напо\u0301мню ва\u0301жное!
Подпи\u0301ска — всего\u0301 сто девяно\u0301сто де\u0301вять рубле\u0301й в ме\u0301сяц. Деше\u0301вле ча\u0301шки ко\u0301фе!
Скажи\u0301 го\u0301лосом, что ну\u0301жно, — и начнём?`;

export let START_HOOK_AUDIO: Buffer | null = null;

export function setStartHookAudio(audio: Buffer | null) {
  START_HOOK_AUDIO = audio;
}

export function clearStartHookMemoryCache() {
  START_HOOK_AUDIO = null;
}

const REDIS_HOOK_KEY = "selin:start_hook_audio_v5_live";

export async function getStartHookAudio(): Promise<Buffer | null> {
  if (START_HOOK_AUDIO && START_HOOK_AUDIO.length > 0) {
    return START_HOOK_AUDIO;
  }
  // 1. Проверяем файловый кэш (assets/start_hook.mp3)
  try {
    const { getCachedStaticAudio } = await import("./tts/groq-tts");
    const fileAudio = await getCachedStaticAudio(VOICE_HOOK_TEXT);
    if (fileAudio && fileAudio.length > 0) {
      START_HOOK_AUDIO = fileAudio;
      console.log("🎙️ [StartHook] cached in memory");
      logger.info("🎙️ [StartHook] cached in memory");
      return START_HOOK_AUDIO;
    }
  } catch (_) {}

  // 2. Проверяем Redis
  try {
    const { redisService } = await import("./RedisService");
    if (redisService.isAvailable()) {
      const b64 = await redisService.get(REDIS_HOOK_KEY);
      if (b64) {
        START_HOOK_AUDIO = Buffer.from(b64, "base64");
        console.log("🎙️ [StartHook] cached in memory");
        logger.info("🎙️ [StartHook] cached in memory");
        return START_HOOK_AUDIO;
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️ [StartHook] Error reading from Redis: ${err?.message || err}`);
  }
  return null;
}

/**
 * Пересоздание аудио приветствия:
 * 1. Удаляет старый assets/start_hook.mp3
 * 2. Сбрасывает in-memory кэш ([StartHook] cached in memory)
 * 3. Синтезирует заново с живой интонацией: rate = 0.95 (prosody rate="95%"), pitch стандартный ("+0Hz")
 * 4. Сохраняет в assets и обновляет кэш
 * Лог: [StartHook] приветствие пересоздано
 */
export async function recreateStartHookAudio(): Promise<Buffer | null> {
  try {
    // 1. Сброс in-memory кэша
    START_HOOK_AUDIO = null;

    // 2. Удаление старого assets/start_hook.mp3
    const { deleteStartHookAsset, saveCachedStaticAudio } = await import("./tts/groq-tts");
    await deleteStartHookAsset();

    // 3. Очистка устаревших ключей в Redis
    try {
      const { redisService } = await import("./RedisService");
      if (redisService.isAvailable()) {
        await redisService.del("selin:start_hook_audio_v4_male");
        await redisService.del(REDIS_HOOK_KEY);
      }
    } catch (_) {}

    // 4. Очистка кэша TTSService
    const { ttsService } = await import("./TTSService");
    ttsService.clearCache();

    // 5. Синтез заново с настройками чёткости: rate = 0.95, prosody rate="95%", pitch стандартный
    const synth = await ttsService.synthesize(VOICE_HOOK_TEXT, {
      voice: "ru-RU-DmitryNeural",
      rate: "95%",
      speed: 0.95,
      pitch: "+0Hz"
    });

    if (synth && synth.length > 0) {
      START_HOOK_AUDIO = synth;

      // 6. Сохраняем в assets
      await saveCachedStaticAudio(HOOK_TEXT, synth);
      await saveCachedStaticAudio(VOICE_HOOK_TEXT, synth);

      // 7. Сохраняем в Redis при доступности
      try {
        const { redisService } = await import("./RedisService");
        if (redisService.isAvailable()) {
          await redisService.set(REDIS_HOOK_KEY, synth.toString("base64"), 30 * 86400);
        }
      } catch (_) {}

      console.log("[StartHook] приветствие пересоздано");
      logger.info("[StartHook] приветствие пересоздано");
      console.log("🎙️ [StartHook] cached in memory");
      logger.info("🎙️ [StartHook] cached in memory");

      return synth;
    } else {
      logger.warn("⚠️ [StartHook] Re-synthesis returned null");
      return null;
    }
  } catch (err: any) {
    logger.error(`❌ [StartHook] Recreate failed: ${err?.message || err}`);
    return null;
  }
}

export async function pregenerateStartHook(force: boolean = false): Promise<void> {
  try {
    if (force) {
      await recreateStartHookAudio();
      return;
    }

    const existing = await getStartHookAudio();
    if (existing && existing.length > 0) {
      return;
    }

    await recreateStartHookAudio();
  } catch (err: any) {
    START_HOOK_AUDIO = null;
    logger.warn("⚠️ [StartHook] Pre-generation failed: " + (err.message || err));
  }
}
