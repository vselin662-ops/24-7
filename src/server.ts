import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';

// 1. Импорт ядра и вспомогательных сервисов Selin AI 2.0
import { LLMService, llmService } from './core/LLMService';
import { MemorySystem, memorySystem } from './core/MemorySystem';
import { TTSService, ttsService, synthesizeForChat } from './services/TTSService';
import { FlightService, flightService } from './services/FlightService';
import { AgentOrchestrator, agentOrchestrator } from './core/AgentOrchestrator';
import { SelinCore } from './core/SelinCore';
import { MessageContext, ChannelType, TaskType } from './core/types';
import { MaxAdapter } from './adapters/MaxAdapter';

// 2. Импорт специализированных агентов
import { OrderAgent } from './agents/OrderAgent';
import { TravelAgent } from './agents/TravelAgent';
import { NewsAgent } from './agents/NewsAgent';
import { ContentAgent } from './agents/ContentAgent';
import { CodingAgent } from './agents/CodingAgent';
import { SalesAgent } from './agents/sales.agent';
import { SupportAgent } from './agents/support.agent';
import { TutorAgent } from './agents/tutor.agent';
import { BusinessAgent } from './agents/business.agent';
import { ConciergeAgent } from './agents/concierge.agent';

import { logger } from './logger';

dotenv.config();

export interface ServerServices {
  app: express.Application;
  server: http.Server;
  wss: WebSocketServer;
  llmService: LLMService;
  memorySystem: MemorySystem;
  ttsService: TTSService;
  flightService: FlightService;
  orchestrator: AgentOrchestrator;
  selinCore: SelinCore;
  maxAdapter: MaxAdapter;
}

/**
 * Инициализация всех сервисов и запуск главного сервера Selin AI 2.0
 */
export function createServerApp(): ServerServices {
  // ==========================================
  // 1. Инициализация сервисов
  // ==========================================
  const selinLLM = llmService;
  const selinMemory = memorySystem;
  const selinTTS = ttsService;
  const selinFlight = flightService;
  const selinOrchestrator = agentOrchestrator;
  const selinCore = new SelinCore(selinLLM);

  // ==========================================
  // 2. Регистрация специализированных агентов
  // ==========================================
  selinOrchestrator.registerAgents([
    new OrderAgent(selinLLM),
    new TravelAgent(selinLLM, selinFlight),
    new NewsAgent(selinLLM),
    new ContentAgent(selinLLM),
    new CodingAgent(selinLLM),
    new SalesAgent(),
    new SupportAgent(),
    new TutorAgent(),
    new BusinessAgent(),
    new ConciergeAgent()
  ]);

  // Адаптер MAX Messenger
  const maxAdapter = new MaxAdapter(selinCore, process.env.MAX_BOT_TOKEN);
  maxAdapter.connect().catch((err) => logger.error('Failed to connect maxAdapter in src/server.ts', { error: err }));

  // ==========================================
  // 3. Express конфигурация
  // ==========================================
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  const server = http.createServer(app);

  // ==========================================
  // 4. REST API Эндпоинты
  // ==========================================

  // MAX Messenger Webhook
  app.post(['/api/max/webhook', '/max/webhook'], async (req, res) => {
    try {
      await maxAdapter.handleWebhook(req, res);
    } catch (err: any) {
      logger.error('❌ MAX Webhook error:', err);
      return res.status(200).send('ok');
    }
  });

  app.get(['/api/max/webhook', '/max/webhook'], (_req, res) => {
    return res.status(200).json({ status: 'ok', service: 'Selin AI MAX Adapter' });
  });

  // Место для интеграции с Telegram Webhook
  app.post('/api/telegram/webhook', async (req, res) => {
    try {
      const update = req.body;
      const message = update?.message;
      if (message && message.text) {
        const chatId = String(message.chat?.id || 'telegram_user');
        const context: MessageContext = {
          chatId,
          tenantId: `tg_${chatId}`,
          channel: ChannelType.TELEGRAM,
          isVoice: false,
          timestamp: Date.now()
        };

        const aiResponse = await selinOrchestrator.processMessage(message.text, context);
        // Ответ может быть отправлен через Telegram Bot API (placeholder / расширение)
        logger.info(`[Telegram] Processed message for ${chatId}: "${aiResponse.text.slice(0, 40)}..."`);
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      logger.error('❌ Telegram Webhook error:', err);
      return res.status(200).json({ ok: false });
    }
  });

  // Очистка и сброс контекста диалога
  app.post('/api/chat/reset', async (req, res) => {
    const { chatId, tenantId } = req.body;
    const targetId = tenantId || chatId || 'default';
    await selinMemory.clearContext(targetId);
    logger.info(`[Server] Reset chat memory for: ${targetId}`);
    return res.json({ success: true, message: `Память диалога ${targetId} успешно очищена.` });
  });

  // Прямой чат с мультиагентным оркестратором
  app.post(['/api/chat/message', '/api/ai/message'], async (req, res) => {
    try {
      const { message, text, chatId = 'web_user', isVoice = false, tenantId } = req.body;
      const userText = String(message || text || '').trim();

      if (!userText) {
        return res.status(400).json({ error: 'Message text is required' });
      }

      const context: MessageContext = {
        chatId: String(chatId),
        tenantId: tenantId || `web_${chatId}`,
        channel: ChannelType.WEB,
        isVoice: Boolean(isVoice),
        timestamp: Date.now()
      };

      const aiResponse = await selinOrchestrator.processMessage(userText, context);
      return res.json(aiResponse);
    } catch (err: any) {
      logger.error('❌ Error processing /api/chat/message:', err);
      return res.status(500).json({ error: err?.message || 'Internal Server Error' });
    }
  });

  // Поиск авиабилетов и туров
  app.get('/api/flights', async (req, res) => {
    try {
      const { origin, destination, cabinClass, passengers } = req.query;
      const deals = await selinFlight.searchFlights({
        origin: origin ? String(origin) : undefined,
        destination: destination ? String(destination) : undefined,
        cabinClass: cabinClass === 'business' ? 'business' : 'economy',
        passengers: passengers ? Number(passengers) : 1
      });
      return res.json({ success: true, count: deals.length, deals });
    } catch (err: any) {
      logger.error('❌ Error in /api/flights:', err);
      return res.status(500).json({ error: err?.message || 'Error searching flights' });
    }
  });

  // Голосовое бронирование билетов
  app.post('/api/flights/voice-book', async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: 'Voice command is required' });
      }
      const result = await selinFlight.voiceBooking(String(command));
      return res.json(result);
    } catch (err: any) {
      logger.error('❌ Error in /api/flights/voice-book:', err);
      return res.status(500).json({ error: err?.message || 'Voice booking error' });
    }
  });

  // Синтез речи (TTS)
  app.post(['/api/tts', '/api/synthesize'], async (req, res) => {
    try {
      const { text, options } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Text parameter is required' });
      }

      const chatId = options?.chatId || (req.query.chatId ? String(req.query.chatId) : 'default');
      const audioBuffer = await synthesizeForChat(chatId, String(text));
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'public, max-age=86400'
      });
      return res.send(audioBuffer);
    } catch (err: any) {
      logger.error('❌ TTS generation error:', err);
      return res.status(500).json({ error: err?.message || 'TTS Error' });
    }
  });

  // Статус и телеметрия оркестратора
  app.get('/api/orchestrator/status', (_req, res) => {
    return res.json({
      status: 'operational',
      orchestrator: selinOrchestrator.getStatus(),
      activeAgents: selinOrchestrator.getActiveAgents()
    });
  });

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    return res.json({
      status: 'healthy',
      system: 'Selin AI 2.0',
      timestamp: new Date().toISOString()
    });
  });

  // ==========================================
  // 5. WebSocket для голосовой колонки ("Колонка Selin AI")
  // ==========================================
  const wss = new WebSocketServer({ server, path: '/ws/colonna' });

  wss.on('connection', (ws: WebSocket, req) => {
    const remoteIp = req.socket.remoteAddress;
    logger.info(`🔊 [Speaker WS] Smart speaker connected from ${remoteIp}`);

    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Колонка Selin AI подключена к ядру',
      capabilities: ['audio_stream', 'voice_wake_word', 'agent_orchestrator']
    }));

    ws.on('message', async (data: any) => {
      try {
        let payload: any = {};
        if (typeof data === 'string' || Buffer.isBuffer(data)) {
          try {
            payload = JSON.parse(data.toString());
          } catch {
            payload = { text: data.toString() };
          }
        }

        const userText = payload.text || payload.message || '';
        const speakerId = payload.speakerId || 'colonna_device_1';

        if (!userText) return;

        logger.info(`🔊 [Speaker WS] Received command: "${userText}" from ${speakerId}`);

        const context: MessageContext = {
          chatId: speakerId,
          tenantId: `speaker_${speakerId}`,
          channel: ChannelType.ROBOT,
          isVoice: true,
          timestamp: Date.now()
        };

        // Обработка через мультиагентный оркестратор
        const aiResponse = await selinOrchestrator.processMessage(userText, context);

        // Синтезируем голос для воспроизведения на колонке
        const audioBuffer = await synthesizeForChat(speakerId, aiResponse.text);

        ws.send(JSON.stringify({
          type: 'response',
          text: aiResponse.text,
          confidence: aiResponse.confidence,
          audioBase64: audioBuffer.toString('base64'),
          actions: aiResponse.actions || []
        }));
      } catch (err: any) {
        logger.error('❌ [Speaker WS] Error processing message:', err);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Ошибка при обработке запроса колонки'
        }));
      }
    });

    ws.on('close', () => {
      logger.info(`🔊 [Speaker WS] Smart speaker disconnected (${remoteIp})`);
    });
  });

  return {
    app,
    server,
    wss,
    llmService: selinLLM,
    memorySystem: selinMemory,
    ttsService: selinTTS,
    flightService: selinFlight,
    orchestrator: selinOrchestrator,
    selinCore,
    maxAdapter
  };
}

// ==========================================
// 6. Запуск сервера при прямом вызове
// ==========================================
const isDirectRun = process.env.RUN_SRC_SERVER === 'true';
if (isDirectRun) {
  const PORT = 3000;
  const { server } = createServerApp();

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 [Selin AI 2.0] Server running on http://0.0.0.0:${PORT}`);
    logger.info(`🔊 [Selin AI 2.0] Smart Speaker WebSocket available at ws://0.0.0.0:${PORT}/ws/colonna`);
  });
}
