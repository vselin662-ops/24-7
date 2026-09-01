import { logger } from "../logger";

export const HOOK_TEXT = `Скажу честно: сколько времени вы сегодня потратили на погоду, новости и планы? Десять минут? Двадцать? Умножьте на триста шестьдесят пять — получится от пяти до десяти дней жизни в год, которые уходят на рутину.
Я — Селин, личный ИИ-ассистент. Пока вы завтракаете, я уже собрал ваш брифинг: погода, план дня, важное. Озвучиваю книги и Библию, понимаю фото, нахожу цены и новости. Смогу собрать список продуктов под любое блюдо и посчитать смету. Соберу заказ под ваши потребности — от продуктов до стройматериалов — и организую доставку. Запоминаю ваши привычки и с каждым днём становлюсь точнее.
Представьте: через неделю ваше утро начинается не с лихорадочного листания лент, а с готового плана, озвученного для вас.
Это стоит сто девяносто девять рублей в месяц — дешевле чашки кофе за время, которое я возвращаю вам каждый день.
Нажмите кнопку оплаты и пришлите скриншот — я приступаю к работе с этой минуты.`;

export const VOICE_HOOK_TEXT = HOOK_TEXT;

export let START_HOOK_AUDIO: Buffer | null = null;

export function setStartHookAudio(audio: Buffer | null) {
  START_HOOK_AUDIO = audio;
}

export async function getStartHookAudio(): Promise<Buffer | null> {
  if (START_HOOK_AUDIO && START_HOOK_AUDIO.length > 0) {
    return START_HOOK_AUDIO;
  }
  try {
    const { redisService } = await import("./RedisService");
    if (redisService.isAvailable()) {
      const b64 = await redisService.get("selin:start_hook_audio_v3_male");
      if (b64) {
        START_HOOK_AUDIO = Buffer.from(b64, "base64");
        return START_HOOK_AUDIO;
      }
    }
  } catch (err: any) {
    logger.warn(`⚠️ [StartHook] Error reading from Redis: ${err?.message || err}`);
  }
  return null;
}

export async function pregenerateStartHook(): Promise<void> {
  try {
    const { redisService } = await import("./RedisService");
    const { synthesizeForChat } = await import("./TTSService");

    // 1. Try to load from Redis first if available
    if (redisService.isAvailable()) {
      try {
        const cachedB64 = await redisService.get("selin:start_hook_audio_v3_male");
        if (cachedB64) {
          START_HOOK_AUDIO = Buffer.from(cachedB64, "base64");
          console.log("🎙️ [StartHook] pre-generated and cached (memory+redis)");
          logger.info("🎙️ [StartHook] pre-generated and cached (memory+redis)");
          return;
        }
      } catch (_) {}
    }

    // 2. Synthesize using TTSService
    const synth = await synthesizeForChat("global_start_hook", HOOK_TEXT);
    if (synth && synth.length > 0) {
      START_HOOK_AUDIO = synth;
      if (redisService.isAvailable()) {
        try {
          await redisService.set("selin:start_hook_audio_v3_male", synth.toString("base64"), 30 * 86400);
          console.log("🎙️ [StartHook] pre-generated and cached (memory+redis)");
          logger.info("🎙️ [StartHook] pre-generated and cached (memory+redis)");
        } catch (_) {
          console.log("🎙️ [StartHook] cached in memory");
          logger.info("🎙️ [StartHook] cached in memory");
        }
      } else {
        console.log("🎙️ [StartHook] cached in memory");
        logger.info("🎙️ [StartHook] cached in memory");
      }
    } else {
      START_HOOK_AUDIO = null;
      logger.warn("⚠️ [StartHook] Pre-generation synthesis returned null");
    }
  } catch (err: any) {
    START_HOOK_AUDIO = null;
    logger.warn("⚠️ [StartHook] Pre-generation failed: " + (err.message || err));
  }
}
