import { logger } from "../logger";

export const HOOK_TEXT = `Приветствую! Я — Селин, ваш персональный AI-ассистент нового поколения. Я говорю с вами голосом, как настоящий помощник. Больше не нужно печатать — просто скажите, что вам нужно. Хотите заказать продукты из магазина? Просто скажите: 'Нужны продукты' — и я помогу выбрать и оформить доставку. Требуются строительные материалы? Скажите: 'Нужны стройматериалы' — и я найду лучшие предложения. Помогу с бизнесом, найду дорогу, напомню важное. Подписка стоит всего 199 рублей в месяц — дешевле чашки кофе. Готовы попробовать? Просто напишите или скажите что-нибудь — и мы начнём!`;

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
      const b64 = await redisService.get("selin:start_hook_audio_v4_male");
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
        const cachedB64 = await redisService.get("selin:start_hook_audio_v4_male");
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
          await redisService.set("selin:start_hook_audio_v4_male", synth.toString("base64"), 30 * 86400);
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
