import fs from 'fs';
import path from 'path';
import { logger } from '../../logger';
import { HOOK_TEXT, VOICE_HOOK_TEXT } from '../StartHookService';

let groqTTSModelsCache: string[] | null = null;
let groqTTSModelsCacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const WELCOME_VOICE = `Привет! Я Selin AI. Я слышу тебя и отвечу голосом. Просто скажи, что тебе нужно, или задай вопрос. Я здесь, чтобы помочь.`;

/**
 * Fetch and cache the available TTS-capable models from Groq.
 * Choose models whose ID contains 'tts' or 'speech'.
 */
export async function fetchGroqTTSModels(): Promise<string[]> {
  const now = Date.now();
  if (groqTTSModelsCache && (now - groqTTSModelsCacheTime < CACHE_TTL_MS)) {
    return groqTTSModelsCache;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.includes('your_') || apiKey.includes('placeholder') || apiKey.length < 10) {
    return [];
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      logger.warn(`⚠️ [TTS] Failed to fetch Groq models: HTTP ${res.status}`);
      return [];
    }

    const data: any = await res.json();
    const ids: string[] = Array.isArray(data?.data)
      ? data.data.map((m: any) => m?.id).filter((id: any) => typeof id === 'string')
      : [];

    const ttsModels = ids.filter(id => id.toLowerCase().includes('tts') || id.toLowerCase().includes('speech'));
    groqTTSModelsCache = ttsModels;
    groqTTSModelsCacheTime = now;
    return ttsModels;
  } catch (err: any) {
    logger.error(`❌ [TTS] Exception while fetching Groq TTS models: ${err?.message || err}`);
    return [];
  }
}

// Proactively fetch and cache models on start
fetchGroqTTSModels().catch(() => {});

/**
 * Select the best TTS model from the list.
 * Priority: playai-tts -> orpheus -> first available.
 */
export async function pickGroqTTSModel(): Promise<string | null> {
  const models = await fetchGroqTTSModels();
  if (models.length === 0) {
    return null;
  }

  const playai = models.find(m => m.toLowerCase().includes('playai-tts') || m.toLowerCase().includes('playai'));
  if (playai) return playai;

  const orpheus = models.find(m => m.toLowerCase().includes('orpheus'));
  if (orpheus) return orpheus;

  return models[0];
}

/**
 * Check if the text matches either of the static texts (Start Hook or Welcome Voice)
 * and load the cached .mp3 from assets if it exists.
 */
export async function getCachedStaticAudio(text: string): Promise<Buffer | null> {
  const cleanText = text.trim();
  let fileName = '';

  if (cleanText === WELCOME_VOICE.trim()) {
    fileName = 'welcome.mp3';
  } else if (
    cleanText === HOOK_TEXT.trim() ||
    cleanText === VOICE_HOOK_TEXT.trim() ||
    cleanText.includes("Здравствуй! Я — Селин") ||
    cleanText.includes("Здравствуй! Я — Сели\u0301н")
  ) {
    fileName = 'start_hook.mp3';
  }

  if (!fileName) {
    return null;
  }

  const possiblePaths = [
    path.join(process.cwd(), 'src', 'assets', fileName),
    path.join(process.cwd(), 'assets', fileName)
  ];

  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const buf = await fs.promises.readFile(filePath);
        if (buf && buf.length > 0) {
          logger.info(`⚡ [TTS] Static audio loaded from asset file cache: ${filePath}`);
          return buf;
        }
      }
    } catch (err: any) {
      logger.warn(`⚠️ [TTS] Failed to read cached asset ${filePath}: ${err?.message || err}`);
    }
  }

  return null;
}

/**
 * Write the successfully synthesized static audio to /src/assets/ and /assets/
 */
export async function saveCachedStaticAudio(text: string, buffer: Buffer): Promise<void> {
  const cleanText = text.trim();
  let fileName = '';

  if (cleanText === WELCOME_VOICE.trim()) {
    fileName = 'welcome.mp3';
  } else if (
    cleanText === HOOK_TEXT.trim() ||
    cleanText === VOICE_HOOK_TEXT.trim() ||
    cleanText.includes("Здравствуй! Я — Селин") ||
    cleanText.includes("Здравствуй! Я — Сели\u0301н")
  ) {
    fileName = 'start_hook.mp3';
  }

  if (!fileName) {
    return;
  }

  const targetDirs = [
    path.join(process.cwd(), 'src', 'assets'),
    path.join(process.cwd(), 'assets')
  ];

  for (const dir of targetDirs) {
    try {
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      const filePath = path.join(dir, fileName);
      await fs.promises.writeFile(filePath, buffer);
      logger.info(`💾 [TTS] Static audio saved to assets: ${filePath}`);
    } catch (err: any) {
      logger.warn(`⚠️ [TTS] Failed to save static audio asset to ${dir}: ${err?.message || err}`);
    }
  }
}

/**
 * Delete start_hook.mp3 from all asset locations
 */
export async function deleteStartHookAsset(): Promise<void> {
  const possiblePaths = [
    path.join(process.cwd(), 'src', 'assets', 'start_hook.mp3'),
    path.join(process.cwd(), 'assets', 'start_hook.mp3')
  ];

  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        logger.info(`🗑️ [StartHook] Deleted asset: ${filePath}`);
      }
    } catch (err: any) {
      logger.warn(`⚠️ [StartHook] Error deleting ${filePath}: ${err?.message || err}`);
    }
  }
}

/**
 * Synthesize text using Groq TTS.
 */
export async function synthesizeWithGroq(text: string): Promise<Buffer | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = await pickGroqTTSModel();
  if (!model) {
    logger.warn("⚠️ [TTS] No Groq TTS models available.");
    return null;
  }

  const voice = 'Fritz-PlayAI';
  const url = 'https://api.groq.com/openai/v1/audio/speech';
  const body = {
    model,
    voice,
    input: text,
    response_format: 'mp3'
  };

  const executeRequest = async () => {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000) // 15s timeout
    });
  };

  const startTime = Date.now();
  let response: Response;

  try {
    response = await executeRequest();
  } catch (err: any) {
    logger.warn(`⚠️ [TTS] Groq request failed or timed out: ${err?.message || err}`);
    return null;
  }

  // Handle 429 rate limit with 1s retry delay
  if (response.status === 429) {
    logger.warn("⚠️ [TTS] Groq 429 Rate Limit. Retrying in 1s...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      response = await executeRequest();
    } catch (err: any) {
      logger.warn(`⚠️ [TTS] Groq retry request failed: ${err?.message || err}`);
      return null;
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    logger.warn(`⚠️ [TTS] Groq response error: ${response.status} ${errorText}`);
    return null;
  }

  const arrayBuffer = await response.arrayBuffer();
  const latency = Date.now() - startTime;

  // Observability log requirement: '🎙 [TTS] engine=Groq model=<m> voice=<v> latency=<ms>'
  const logMsg = `🎙 [TTS] engine=Groq model=${model} voice=${voice} latency=${latency}ms`;
  console.log(logMsg);
  logger.info(logMsg);

  return Buffer.from(arrayBuffer);
}
