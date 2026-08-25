export interface WakeWordResult {
  detected: boolean;
  voice: "Charon" | "Kore" | null;
  mode: "male" | "female" | null;
  cleanedText: string;
  isOnlyWakeWord: boolean;
  confirmationSpeech: string;
}

export function normalizeForWakeWord(text: string): string {
  if (!text) return "";
  let s = text.toLowerCase();
  
  s = s.replace(/семьсот\s*семьдесят\s*семь/g, "777");
  s = s.replace(/три\s*сем[её]рки/g, "777");
  s = s.replace(/три\s*нуля/g, "000");
  s = s.replace(/семь\s*семь\s*семь/g, "777");
  s = s.replace(/ноль\s*ноль\s*ноль/g, "000");
  s = s.replace(/нуль\s*нуль\s*нуль/g, "000");
  s = s.replace(/\bсемь\b/g, "7");
  s = s.replace(/\bноль\b/g, "0");
  s = s.replace(/\bнуль\b/g, "0");
  
  return s;
}

export function detectVoiceWakeWord(rawText: string): WakeWordResult {
  if (!rawText || typeof rawText !== "string") {
    return { detected: false, voice: null, mode: null, cleanedText: rawText || "", isOnlyWakeWord: false, confirmationSpeech: "" };
  }

  const normalized = normalizeForWakeWord(rawText);
  const compactText = rawText.toLowerCase().replace(/[\s\-_.,!?:;]+/g, "");

  // Patterns for male wake-word: Selin777 / Селин 777
  const maleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:7\s*7\s*7|777|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь)/i;
  // Patterns for female wake-word: Selin000 / Селин 000
  const femaleRegex = /(?:selin|селин|силин|селен|салин|целин|zelin)\s*(?:0\s*0\s*0|000|[oо]\s*[oо]\s*[oо]|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нуль\s*нуль\s*нуль)/i;

  let matchedMode: "male" | "female" | null = null;
  let targetVoice: "Charon" | "Kore" | null = null;

  if (maleRegex.test(normalized) || compactText.includes("selin777") || compactText.includes("селин777") || compactText.includes("силин777")) {
    matchedMode = "male";
    targetVoice = "Charon";
  } else if (femaleRegex.test(normalized) || compactText.includes("selin000") || compactText.includes("селин000") || compactText.includes("силин000") || compactText.includes("selinooo") || compactText.includes("селинооо")) {
    matchedMode = "female";
    targetVoice = "Kore";
  }

  if (!matchedMode || !targetVoice) {
    return { detected: false, voice: null, mode: null, cleanedText: rawText.trim(), isOnlyWakeWord: false, confirmationSpeech: "" };
  }

  // Remove the wake word from raw text
  let cleaned = rawText;
  if (matchedMode === "male") {
    cleaned = cleaned.replace(/(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:777|7\s*7\s*7|три\s*сем[её]рки|семь\s*семь\s*семь|семьсот\s*семьдесят\s*семь)/gi, "");
    cleaned = cleaned.replace(/selin777|селин777|силин777/gi, "");
  } else {
    cleaned = cleaned.replace(/(?:selin|селин|силин|селен|салин|целин|zelin)[\s\-_]*(?:000|0\s*0\s*0|[oо]{3}|три\s*нуля|ноль\s*ноль\s*ноль|нуль\s*нуль\s*нуль)/gi, "");
    cleaned = cleaned.replace(/selin000|селин000|силин000|selinooo|селинооо/gi, "");
  }

  cleaned = cleaned.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, "").trim();
  const isOnlyWakeWord = cleaned.length === 0;

  const confirmationSpeech = matchedMode === "male"
    ? "Голос изменён на мужской."
    : "Голос изменён на женский.";

  return {
    detected: true,
    voice: targetVoice,
    mode: matchedMode,
    cleanedText: cleaned,
    isOnlyWakeWord,
    confirmationSpeech
  };
}
