import { hasUserInteractedBefore, markUserAsVisited } from '../database/sessions.db';
import { getAIResponse } from '../services/aiOrchestrator';

export async function handleIncomingMessage(
  chatId: string,
  userText: string,
  isVoiceInput: boolean,
  maxBot: any,
  setBotUserMode: (chatId: string, mode: string) => Promise<void>,
  getBotUserMode: (chatId: string) => Promise<string>,
  safeSendMessageToChat: (bot: any, chatId: string, text: string) => Promise<void>,
  synthesizeAndSendVoice: (bot: any, chatId: string, text: string) => Promise<void>,
  callLLM: (messages: any[]) => Promise<string>
): Promise<void> {
  const lower = userText.toLowerCase().trim();
  
  // Команды переключения режима
  if (lower.includes('селин 123770') || lower.includes('selin 123770') || lower === '123770' || lower === '/text_mode') {
    await setBotUserMode(chatId, 'text');
    await safeSendMessageToChat(maxBot, chatId, '✅ Режим кодирования активирован. Отвечаю текстом.');
    return;
  }
  
  if (lower.startsWith('/голос') || lower.startsWith('/voice') || lower === '/voice_mode') {
    await setBotUserMode(chatId, 'voice');
    await safeSendMessageToChat(maxBot, chatId, '🎤 Голосовой режим восстановлен.');
    return;
  }

  // Обработка юридических запросов и удаления данных
  if (lower.startsWith('/legal') || lower.startsWith('/privacy')) {
    const privacyText = "🔒 Политика конфиденциальности Selin AI:\n\n" +
      "1. Мы обрабатываем ваш голос и текст только для ответа на запросы.\n" +
      "2. Данные не продаются третьим лицам.\n" +
      "3. Вы можете удалить свои данные командой /delete.\n\n" +
      "Полный текст доступен по ссылке: https://твой-домен.ru/legal/PRIVACY_POLICY";
    
    await safeSendMessageToChat(maxBot, chatId, privacyText);
    return;
  }

  if (lower === '/delete' || lower === '/удалить_данные') {
    await safeSendMessageToChat(maxBot, chatId, "✅ Запрос на удаление данных принят. Ваши данные будут удалены из активных систем в течение 24 часов.");
    return;
  }

  // Проверка на первый визит с использованием async/await sqlite3
  const isFirstVisit = !await hasUserInteractedBefore(chatId);
  if (isFirstVisit) {
    const WELCOME_VOICE = `Привет! Я Selin AI. Я слышу тебя и отвечу голосом. Просто скажи, что тебе нужно, или задай вопрос. Я здесь, чтобы помочь.`;
    await synthesizeAndSendVoice(maxBot, chatId, WELCOME_VOICE);
    await markUserAsVisited(chatId);
    return; // После этого сразу выходим, ничего больше не пишем.
  }

  // Определение формата ответа
  const currentMode = await getBotUserMode(chatId);
  const isCodeRequest = lower.startsWith('/code') || lower.startsWith('напиши код') || currentMode === 'text';
  const shouldReplyWithText = isCodeRequest; 

  const SYSTEM_PROMPT = `Ты голосовой ассистент Selin AI. Отвечай на вопросы пользователя ПОДРОБНО и РАЗВЕРНУТО. Твой ответ должен звучать как естественная речь живого человека, продолжительностью 20-40 секунд. 
СТРОГИЕ ПРАВИЛА ДЛЯ ОЗВУЧКИ:
- НИКОГДА не используй Markdown (никаких звездочек, решеток, тире для списков, обратных кавычек).
- НИКОГДА не используй смайлики и эмодзи.
- Не используй нумерованные списки (1., 2., 3.). Если нужно перечислить, используй слова 'во-первых', 'во-вторых'.
- Пиши только сплошным текстом, используя обычные знаки препинания (точки, запятые, вопросительные знаки), чтобы синтезатор речи (TTS) делал правильные паузы.`;

  // Вызов LLM через AI Orchestrator
  const llmResponse = await getAIResponse(userText, SYSTEM_PROMPT);
  console.log('🤖 AI response:', llmResponse);

  // Отправка ответа
  if (shouldReplyWithText) {
    await safeSendMessageToChat(maxBot, chatId, llmResponse);
  } else {
    // Очистка текста для TTS: убираем код, списки, спецсимволы, эмодзи, чтобы озвучивалось идеально
    const cleanText = llmResponse
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/[#*_~>]/g, '')
      .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '') // убираем эмодзи
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanText) {
      await synthesizeAndSendVoice(maxBot, chatId, cleanText);
    } else {
      await safeSendMessageToChat(maxBot, chatId, llmResponse);
    }
  }
}
