import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { getVoiceConfig } from "../../db";
import { normalizeForSpeech } from "../utils/textUtils";
import { logger } from "../logger";

export async function transcribeAudio(audioBuffer: Buffer, filename: string = 'voice.ogg'): Promise<string> {
  try {
    const key = process.env.GROQ_API_KEY;
    if (!key) {
      logger.warn("⚠️ GROQ_API_KEY не задан в окружении! Whisper STT вернет пустую строку.");
      return "";
    }

    const form = new FormData();
    const fileBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    form.append('file', fileBlob, filename);
    form.append('model', 'whisper-large-v3');
    form.append('language', 'ru');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`
      },
      body: form,
      signal: AbortSignal.timeout(25000)
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || contentType.includes("text/html")) {
      const errText = await response.text();
      logger.error(`❌ [Groq Whisper STT Error] HTTP ${response.status}: ${errText.slice(0, 200)}`);
      return "";
    }

    const data = await response.json() as any;
    let text = (data.text || "").trim();

    // Фильтрация галлюцинаций Whisper при тишине/шуме
    const lower = text.toLowerCase();
    if (
      lower.includes('dimatorzok') ||
      lower.includes('дима торжок') ||
      lower.includes('субтитры') ||
      lower.includes('субтитрами') ||
      lower.includes('создал субтитры') ||
      lower.includes('редактор субтитров') ||
      lower.includes('продолжение следует') ||
      lower.includes('спасибо за просмотр')
    ) {
      logger.warn(`⚠️ [Groq Whisper STT] Отфильтрована галлюцинация Whisper: "${text}"`);
      text = "";
    }

    logger.info(`✅ [Groq Whisper STT Success] Распознанный текст: "${text}"`);
    return text;
  } catch (err: any) {
    logger.error(`❌ [Groq Whisper STT Failed] Ошибка при распознавании речи: ${err?.message || err}`);
    return "";
  }
}

export async function transcribeAudioBuffer(buf: Buffer): Promise<string> {
  return transcribeAudio(buf, 'voice.ogg');
}

export async function downloadMaxAudio(fileUrl: string): Promise<Buffer> {
  const url = (fileUrl || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error(`Нужна прямая ссылка payload.url, а не токен (получено: "${url}")`);
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'audio/*, application/octet-stream'
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'No error body');
    throw new Error(`Failed to download audio (HTTP ${res.status}): ${errorText}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.length === 0) {
    throw new Error('Downloaded audio is empty');
  }

  return buffer;
}

export async function generateAudioTtsBuffer(text: string, chatId?: string | number): Promise<{ buffer: Buffer; voiceName: string }> {
  const voicePrepared = normalizeForSpeech(text);
  const voiceConfig = getVoiceConfig(chatId);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(
    voiceConfig.voice,
    OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
  );

  const { audioStream } = tts.toStream(voicePrepared, { rate: voiceConfig.rate, pitch: voiceConfig.pitch });
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
  }
  const audioBuffer = Buffer.concat(chunks);
  return {
    buffer: audioBuffer,
    voiceName: voiceConfig.gender === 'female' ? 'Kore' : 'Charon'
  };
}
