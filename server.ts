import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { sqliteDb } from "./db";
import { apiRateLimiter, expensiveOpLimiter } from "./middleware/rateLimit";
import { authMiddleware } from "./middleware/auth";
import { logger } from "./src/logger";
import { metrics } from "./src/metrics";
import { requestIdMiddleware } from "./src/middleware/requestId";
import { aiShieldMiddleware } from "./src/middleware/ai-shield";
import { filterAIOutput } from "./src/services/output-filter";
import { trackUserRateAndAnomalies } from "./src/services/agent-monitor";
import { llmService } from "./src/core/LLMService";
import { SelinCore } from "./src/core/SelinCore";
import { MaxAdapter as ModernMaxAdapter } from "./src/adapters/MaxAdapter";
import { checkRequiredEnvVars } from "./src/config/env";
import { initSessionsDb, closeDatabase } from "./src/index";

// Import Modular Routers
import languageRouter from "./src/routes/language.routes";
import securityRouter from "./src/routes/security.routes";
import { fintechRouter } from "./src/fintech/routes";
import voiceRouter from "./src/routes/voice.routes";
import adminRouter from "./src/routes/admin.routes";
import aiRouter from "./src/routes/ai.routes";
import mcpRouter from "./src/routes/mcp.routes";
import legalRouter from "./src/routes/legal.routes";
import { adminGuard, adminLoginHandler } from "./src/middleware/adminAuth";

// Re-exports for voice normalizer, text utilities, and bible service
export {
  numberToWords,
  cardinal,
  ordinalM,
  ordinalF,
  ordinalGenM,
  ordinalPrepM,
  yearToSpeech,
  числительное,
  normalizeBiblicalReferences,
  normalizeYears,
  normalizeTimeOfDay,
  normalizeHours12
} from "./src/utils/voiceNormalizer";
export { cleanForMax, prepareVoiceText, normalizeForVoice, splitTextSmart } from "./src/utils/textUtils";
export {
  handleBibleSubscription,
  startBibleScheduler,
  checkAndSendBibleBroadcast,
  BIBLE_SLOTS,
  getDaysPassed,
  getDayIndex,
  getPlanDaySummary,
  getPlanContentsSummary,
  skipUserPlanDays,
  getUserPlanDay,
  isPlanFileExisting
} from "./src/services/bibleService";
export {
  handleCallback,
  handleCityInput,
  renderBriefingMenu,
  renderPlanMenu,
  geocodeCityWithNominatim,
  isWaitingForCity,
  setWaitingForCity
} from "./src/services/CallbackRouter";
import { startBibleScheduler } from "./src/services/bibleService";
import { startMorningScheduler } from "./src/services/morningBriefing";
import { SecurityGateway } from "./src/core/SecurityGateway";

dotenv.config();
checkRequiredEnvVars();

export const app = express();
export const PORT = 3000;

app.set("trust proxy", 1);

// 1. Request ID and Metrics Tracking Middleware
app.use(requestIdMiddleware);
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const tenantId = (req as any).user?.tenant_id || (req as any).user?.chatId || (req as any).tenant_id || "default";
    const routePath = req.route ? req.route.path : req.path;

    logger.info(SecurityGateway.maskPII(`HTTP ${req.method} ${req.path} ${res.statusCode}`), {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
      tenantId,
      requestId: (req as any).requestId,
    });

    metrics.incrementCounter("http_requests_total", {
      method: req.method,
      path: routePath,
      status: String(res.statusCode),
      tenant_id: tenantId,
    });

    metrics.observeHistogram("http_request_duration_seconds", durationMs / 1000, {
      method: req.method,
      path: routePath,
    });

    metrics.recordTenantActivity(tenantId);
  });
  next();
});

// 2. Global Parsers
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','), credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// 3. Selin AI Core Services Initialization
export const selinLLMService = llmService;
export const selinCore = new SelinCore(selinLLMService);
export const modernMaxAdapter = new ModernMaxAdapter(selinCore, process.env.MAX_BOT_TOKEN);
modernMaxAdapter.connect().catch((err) => logger.error("Failed to connect modernMaxAdapter", { error: err }));

// 4. MAX Messenger Webhook Endpoints
app.post(["/api/max/webhook", "/max/webhook"], async (req, res) => {
  try {
    await modernMaxAdapter.handleWebhook(req, res);
  } catch (error: any) {
    logger.error("❌ MaxAdapter webhook error:", error);
    return res.status(200).send("ok");
  }
});

app.get(["/api/max/webhook", "/max/webhook"], (req, res) => {
  logger.info("MAX webhook GET verification received");
  return res.status(200).json({ ok: true });
});

// 5. Security & Rate Limiting Middlewares for /api routes
app.use("/api", (req, res, next) => {
  if (req.originalUrl.startsWith("/api/max/webhook") || req.originalUrl.startsWith("/api/ai/") || req.originalUrl.startsWith("/api/yookassa") || req.originalUrl.startsWith("/api/robokassa") || req.originalUrl.startsWith("/api/payments")) return next();
  return aiShieldMiddleware(req, res, next);
});

app.use("/api", (req, res, next) => {
  if (req.originalUrl.startsWith("/api/max/webhook") || req.originalUrl.startsWith("/api/ai/") || req.originalUrl.startsWith("/api/yookassa") || req.originalUrl.startsWith("/api/robokassa") || req.originalUrl.startsWith("/api/payments")) return next();
  return apiRateLimiter(req, res, next);
});

app.use(["/api/tts", "/api/synthesize", "/api/voice-organism-dialogue"], (req, res, next) => {
  if (req.originalUrl.startsWith("/api/max/webhook") || req.originalUrl.startsWith("/api/ai/")) return next();
  return expensiveOpLimiter(req, res, next);
});

app.use("/api", (req, res, next) => {
  if (req.originalUrl.startsWith("/api/max/webhook") || req.originalUrl.startsWith("/api/ai/") || req.originalUrl.startsWith("/api/yookassa") || req.originalUrl.startsWith("/api/robokassa") || req.originalUrl.startsWith("/api/payments")) return next();
  const tenantId = (req as any).user?.tenant_id || (req as any).user?.chatId || "default";
  trackUserRateAndAnomalies(tenantId);
  next();
});

// Output Sanitization Filter
app.use((req, res, next) => {
  if (req.originalUrl.startsWith("/api/max/webhook") || req.originalUrl.startsWith("/api/ai/") || req.originalUrl.startsWith("/api/yookassa") || req.originalUrl.startsWith("/api/robokassa") || req.originalUrl.startsWith("/api/payments")) return next();
  const originalJson = res.json;
  const originalSend = res.send;
  const tenantId = (req as any).user?.tenant_id || (req as any).user?.chatId || "default";
  const userPrompt = req.body?.user_message || req.body?.prompt || req.body?.text || "";
  let isJsonCalled = false;

  res.json = function (body: any) {
    isJsonCalled = true;
    if (body && typeof body === "object") {
      if (typeof body.text === "string") {
        body.text = filterAIOutput(body.text, { tenantId, userPrompt });
      }
      if (typeof body.response === "string") {
        body.response = filterAIOutput(body.response, { tenantId, userPrompt });
      }
      if (typeof body.message === "string" && !body.error) {
        body.message = filterAIOutput(body.message, { tenantId, userPrompt });
      }
    }
    return originalJson.call(this, body);
  };

  res.send = function (body: any) {
    if (!isJsonCalled && typeof body === "string") {
      const contentType = res.get("Content-Type");
      if (!contentType || !contentType.includes("application/json")) {
        body = filterAIOutput(body, { tenantId, userPrompt });
      }
    }
    return originalSend.call(this, body);
  };

  next();
});

// 6. Mount Modular API Routers
app.post("/api/admin/login", adminLoginHandler);

app.use((req, res, next) => {
  const url = req.originalUrl;
  
  // Skip logic: if /api/admin/login or /api/admin/status, proceed without adminGuard
  if (
    url === "/api/admin/login" || 
    url.startsWith("/api/admin/login?") || 
    url === "/api/admin/status" || 
    url.startsWith("/api/admin/status?")
  ) {
    return next();
  }

  // Apply adminGuard for specified endpoints
  if (
    url.startsWith("/api/admin") ||
    url.startsWith("/api/moderation") ||
    url.startsWith("/api/knowledge") ||
    url.startsWith("/api/security")
  ) {
    return adminGuard(req, res, next);
  }

  next();
});

app.use(fintechRouter);
app.use("/api", (req, res, next) => {
  if (req.originalUrl.startsWith("/api/max/webhook") || req.originalUrl.startsWith("/api/ai/") || req.originalUrl.startsWith("/api/yookassa") || req.originalUrl.startsWith("/api/robokassa") || req.originalUrl.startsWith("/api/payments")) return next();
  return authMiddleware(req, res, next);
});

app.use("/api/security", securityRouter);
app.use("/api/language", languageRouter);
app.use("/api", voiceRouter);
app.use("/api", adminRouter);
app.use("/api", aiRouter);
app.use("/api", mcpRouter);
app.use(legalRouter);

// Prometheus / OpenMetrics endpoint
app.get("/metrics", async (_, res) => {
  res.setHeader("Content-Type", metrics.getContentType());
  res.send(await metrics.getMetrics());
});

// 7. Server Boot and Lifecycle
async function startServer() {
  try {
    await initSessionsDb();
    logger.info("📁 Sessions Database initialized successfully using sqlite3 (async/await)");

    try {
      const { restoreFromRedis } = await import("./src/fintech/restore");
      await restoreFromRedis();
    } catch (restErr) {
      logger.error("❌ Error running restoreFromRedis:", restErr);
    }

    // === ЧАСТЬ А: АВАРИЙНАЯ АКТИВАЦИЯ КЛИЕНТА (одноразовая миграция) ===
    try {
      const { getSubscription, activateSubscription } = await import("./src/fintech/subscriptions");
      const clientChatId = '27490572';
      const existingSub = getSubscription(clientChatId);
      if (!existingSub || !existingSub.paid_until || new Date(existingSub.paid_until).getTime() <= Date.now()) {
        activateSubscription(clientChatId, 'month', 30);
        console.log(`🚑 [Fix] emergency activation: ${clientChatId} month`);
        logger.info(`🚑 [Fix] emergency activation: ${clientChatId} month`);
      }
    } catch (emErr) {
      logger.error("❌ Error running emergency activation:", emErr);
    }
  } catch (err) {
    logger.error("❌ Error initializing sessions database:", { error: err });
  }

  // Vite development middleware or static production serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`🚀 SELIN Enterprise AI Core running on port ${PORT}`);
    startBibleScheduler(
      async (chatId, text) => {
        await modernMaxAdapter.sendMessage(chatId, text);
      },
      async (chatId, text) => {
        await modernMaxAdapter.sendVoice(chatId, text);
      }
    );
    startMorningScheduler(
      async (chatId, text, extra) => {
        await modernMaxAdapter.safeSendMessageToChat(chatId, text, extra);
      },
      async (chatId, text) => {
        await modernMaxAdapter.sendVoice(chatId, text);
      }
    );

    // Start Subscription Reminder Scheduler
    import("./src/fintech/subscriptions").then(({ startSubscriptionReminderScheduler }) => {
      startSubscriptionReminderScheduler(async (chatId, text, extra) => {
        await modernMaxAdapter.safeSendMessageToChat(chatId, text, extra);
      });
    }).catch((err) => {
      logger.error("❌ Error initializing subscription reminder scheduler:", err);
    });

    // Start Reminder Scheduler
    setInterval(async () => {
      try {
        const { checkAndSendReminders } = await import("./src/services/ReminderService");
        await checkAndSendReminders(async (chatId, text) => {
          await modernMaxAdapter.sendMessage(chatId, text);
        });
      } catch (err) {
        logger.error("❌ Error running checkAndSendReminders:", err);
      }
    }, 20000);

    // Run Voice Synthesis Self-Test & Start Hook Pre-generation
    (async () => {
      try {
        const { synthesizeForChat } = await import("./src/services/TTSService");
        logger.info("🧪 [Voice Self-Test] Initiating voice synthesis self-test...");
        const testChatId = "test_self_check_chat";
        const testText = "Здравствуйте, я Селин, ваш помощник";
        const audioBuffer = await synthesizeForChat(testChatId, testText);
        if (audioBuffer) {
          logger.info(`🧪 [Voice Self-Test] Successfully synthesized "${testText}" for chat ${testChatId}. Buffer size: ${audioBuffer.length} bytes.`);
        } else {
          logger.error(`❌ [Voice Self-Test] Voice self-test returned null Buffer.`);
        }
      } catch (err: any) {
        logger.error(`❌ [Voice Self-Test] Voice self-test failed: ${err.message || err}`);
      }

      // Pre-generate Start Voice Hook (asynchronously, non-blocking)
      try {
        const { pregenerateStartHook } = await import("./src/services/StartHookService");
        await pregenerateStartHook();
      } catch (err: any) {
        logger.warn(`⚠️ [StartHook] Server startup pre-generation error: ${err?.message || err}`);
      }
    })();
  });

  function gracefulShutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    serverInstance.close(async () => {
      logger.info("HTTP server closed.");
      if (sqliteDb) {
        try {
          sqliteDb.close();
          logger.info("Main SQLite database connection closed gracefully.");
        } catch (err) {
          logger.error("Error closing main SQLite connection", { error: err });
        }
      }
      try {
        await closeDatabase();
        logger.info("Sessions SQLite database connection closed gracefully.");
      } catch (err) {
        logger.error("Error closing sessions database:", { error: err });
      }
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forceful shutdown after 10s timeout");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer();
