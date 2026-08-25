import { Router } from "express";
import multer from "multer";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { getVoiceConfig, setVoiceGender } from "../../db";
import { normalizeForVoice } from "../utils/textUtils";
import { detectVoiceWakeWord } from "../utils/wakeWord";
import { transcribeAudioBuffer } from "../services/voiceProcessingService";
import { VoiceMode } from "../core/types";
import { logger } from "../logger";

const voiceRouter = Router();

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// In-memory cache for voice quests
export const questCache = new Map<string, { data: any; createdAt: number }>();

function sanitizeVoiceName(rawName: any): string | null {
  if (!rawName || typeof rawName !== 'string') return null;
  const cleaned = rawName.trim();
  if (cleaned.length > 30 || /extracted|schema|json|let's|context|history|output|prompt|valid|requires/i.test(cleaned)) {
    const match = cleaned.match(/\b([А-ЯЁ][а-яё]{1,15}|[A-Z][a-z]{1,15})\b/);
    if (match && match[1] && !/extracted|schema|json|lets|context|history|output|valid|requires/i.test(match[1])) {
      return match[1];
    }
    return null;
  }
  return cleaned;
}

// 1. Voice Mode GET/POST
voiceRouter.get("/voice-mode", (req, res) => {
  const chatId = req.query.chatId ? String(req.query.chatId) : undefined;
  const currentMode = VoiceMode.TEXT_TO_VOICE;

  res.json({
    currentMode,
    availableModes: [
      {
        id: VoiceMode.TEXT_TO_TEXT,
        name: "Текст → Текст",
        description: "Обычный чат, текстовые ответы без генерации аудио"
      },
      {
        id: VoiceMode.TEXT_TO_VOICE,
        name: "Текст → Голос",
        description: "Бот всегда отвечает синтезированным голосом"
      },
      {
        id: VoiceMode.VOICE_TO_VOICE,
        name: "Голос → Голос",
        description: "Полный голосовой диалог в реальном времени"
      }
    ]
  });
});

voiceRouter.post("/voice-mode", (req, res) => {
  const { chatId, mode } = req.body;
  if (!mode || !Object.values(VoiceMode).includes(mode)) {
    return res.status(400).json({
      error: `Invalid voice mode. Allowed modes: ${Object.values(VoiceMode).join(", ")}`
    });
  }

  logger.info(`🔄 Voice mode updated to ${mode}${chatId ? ` for chat ${chatId}` : ' globally'}`);
  res.json({ success: true, mode, chatId: chatId || 'global' });
});

// 2. TTS Endpoint (Data URL)
voiceRouter.post("/tts", async (req, res) => {
  const { text, chatId } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required." });

  const wakeResult = detectVoiceWakeWord(text);
  let textToSynthesize = text;

  if (wakeResult.detected) {
    setVoiceGender(chatId, wakeResult.mode!);
    textToSynthesize = wakeResult.confirmationSpeech;
  }

  try {
    const voicePrepared = normalizeForVoice(textToSynthesize);
    const voiceConfig = getVoiceConfig(chatId);
    logger.info(`🎙️ [TTS] ${voiceConfig.gender === 'female' ? 'SvetlanaNeural' : 'DmitryNeural'}, символов: ${voicePrepared.length}`);
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
    const dataUrl = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    return res.json({
      audioUrl: dataUrl,
      voice: voiceConfig.gender === 'female' ? 'Kore' : 'Charon',
      wakeDetected: wakeResult.detected,
      mode: wakeResult.mode,
      confirmationSpeech: wakeResult.detected ? wakeResult.confirmationSpeech : undefined,
      text: textToSynthesize
    });
  } catch (e: any) {
    logger.error("TTS endpoint failed:", { error: e?.message });
    return res.status(500).json({ error: "Failed to generate audio from TTS." });
  }
});

// 3. Synthesize Endpoint (Base64 audio)
voiceRouter.post("/synthesize", async (req, res) => {
  const { text, chatId } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Text is required for synthesis." });
  }

  try {
    const wakeResult = detectVoiceWakeWord(text);
    let textToSynthesize = text;

    if (wakeResult.detected) {
      setVoiceGender(chatId, wakeResult.mode!);
      textToSynthesize = wakeResult.confirmationSpeech;
    }

    const voicePrepared = normalizeForVoice(textToSynthesize);
    const voiceConfig = getVoiceConfig(chatId);
    logger.info(`🎙️ [TTS Synthesize] ${voiceConfig.gender === 'female' ? 'SvetlanaNeural' : 'DmitryNeural'}, символов: ${voicePrepared.length}`);
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
    const base64Audio = audioBuffer.toString('base64');

    res.json({
      audio: base64Audio,
      voice: voiceConfig.gender === 'female' ? 'Kore' : 'Charon',
      wakeDetected: wakeResult.detected,
      mode: wakeResult.mode,
      confirmationSpeech: wakeResult.detected ? wakeResult.confirmationSpeech : undefined,
      text: textToSynthesize
    });
  } catch (error: any) {
    logger.error("TTS Synthesis Error:", { error: error?.message });
    res.status(500).json({ error: error.message || "Failed to synthesize voice" });
  }
});

// 4. Transcribe Base64 JSON
voiceRouter.post("/transcribe", async (req, res) => {
  try {
    const { audio } = req.body || {};
    if (!audio) {
      return res.json({ text: "" });
    }
    const buf = Buffer.from(audio, "base64");
    const text = await transcribeAudioBuffer(buf);
    return res.json({ text });
  } catch (err: any) {
    logger.error("Transcribe error:", { error: err?.message || err });
    return res.json({ text: "" });
  }
});

// 5. Transcribe Multipart/form-data
voiceRouter.post("/voice/transcribe", audioUpload.single("audio"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Файл записи не передан" });
    }
    const text = await transcribeAudioBuffer(req.file.buffer);
    logger.info(`🎤 Voice transcribed (${req.file.size} bytes): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
    const wakeResult = detectVoiceWakeWord(text);

    return res.json({
      text,
      confidence: text ? 0.98 : 0,
      duration: Math.round(req.file.size / 32000) || 1,
      wakeWord: wakeResult.detected ? wakeResult : null
    });
  } catch (err: any) {
    logger.error("POST /api/voice/transcribe error:", { error: err?.message || err });
    return res.status(500).json({ error: err?.message || "Ошибка распознавания речи" });
  }
});

// 6. Voice Quest Fetching
voiceRouter.get("/get-voice-quest", (req, res) => {
  const chatId = req.query.chatId as string;
  if (!chatId) {
    return res.status(400).json({ error: "chatId query parameter is required." });
  }
  const cached = questCache.get(chatId);
  if (!cached) {
    return res.status(404).json({ error: "Voice quest not found or expired." });
  }
  if (Date.now() - cached.createdAt > 10 * 60 * 1000) {
    questCache.delete(chatId);
    return res.status(410).json({ error: "Voice quest expired." });
  }
  return res.json(cached.data);
});

// 7. Voice Organism Live Dialogue
voiceRouter.post("/voice-organism-dialogue", async (req, res) => {
  let { step, userName, userInput, chatId } = req.body;

  if (userInput && typeof userInput === "string") {
    const wakeResult = detectVoiceWakeWord(userInput);
    if (wakeResult.detected) {
      setVoiceGender(chatId || "preview", wakeResult.mode!);
      return res.json({
        speech: wakeResult.confirmationSpeech,
        userName: sanitizeVoiceName(userName),
        extractedGoal: null,
        nextStep: step || "EXPLAIN_PLATFORM",
        voice: wakeResult.voice,
        wakeDetected: true,
        mode: wakeResult.mode
      });
    }
  }

  const voiceConfig = getVoiceConfig(chatId);
  let extractedName = sanitizeVoiceName(userName);
  let speech = "Приветствую вас! Я ваш интеллектуальный помощник Selin AI. Чем могу помочь вам сегодня?";
  let nextStep = step || "EXPLAIN_PLATFORM";

  if (!userInput && !userName) {
    speech = "Приветствую вас! Я ваш новый интеллектуальный помощник и инженер ваших задач. Как я могу к вам обращаться?";
    nextStep = "ASK_NAME";
  } else if (step === "ASK_NAME" || (!userName && userInput)) {
    const parsed = String(userInput).replace(/меня зовут|я |меня |привет|здравствуй/gi, "").trim();
    extractedName = sanitizeVoiceName(parsed) || "Друг";
    speech = `Приятно познакомиться, ${extractedName}! Я готов помочь вам с решением задач, автоматизацией и вопросами. Что вас интересует?`;
    nextStep = "EXPLAIN_PLATFORM";
  }

  return res.json({
    speech,
    userName: extractedName,
    extractedGoal: userInput || null,
    nextStep,
    voice: voiceConfig.gender === 'female' ? 'Kore' : 'Charon',
    wakeDetected: false
  });
});

export default voiceRouter;
