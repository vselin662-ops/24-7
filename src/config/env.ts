import crypto from "crypto";
import { logger } from "../logger";

export function checkRequiredEnvVars() {
  if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
      logger.error("❌ CRITICAL: Missing required env vars: JWT_SECRET");
      process.exit(1);
    } else {
      logger.warn("⚠️ JWT_SECRET is not set in environment. Generating an ephemeral secret for development session.");
      process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
    }
  }

  const required: string[] = [];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logger.error(`❌ CRITICAL: Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Проверка и автоматическая корректировка URL-адресов OpenAI-совместимых роутеров
  const urlVars = [
    { name: "OPENAI_BASE_URL", val: process.env.OPENAI_BASE_URL },
    { name: "TEAMO_BASE_URL", val: process.env.TEAMO_BASE_URL },
    { name: "AGENT_ROUTER_BASE_URL", val: process.env.AGENT_ROUTER_BASE_URL },
    { name: "ORCA_BASE_URL", val: process.env.ORCA_BASE_URL },
    { name: "NARA_BASE_URL", val: process.env.NARA_BASE_URL },
    { name: "TOKENHARBOR_BASE_URL", val: process.env.TOKENHARBOR_BASE_URL }
  ];

  urlVars.forEach(v => {
    if (v.val) {
      const url = v.val.trim();
      if (!url.endsWith('/v1') && !url.endsWith('/v1beta') && !url.includes('/v1/') && !url.includes('/v1beta/')) {
        const corrected = url.replace(/\/$/, '') + '/v1';
        logger.warn(`⚠️ [API URL Check] Переменная ${v.name} не заканчивается на /v1. Корректируем автоматически с "${url}" на "${corrected}"`);
        process.env[v.name] = corrected;
      } else {
        logger.info(`✅ [API URL Check] Переменная ${v.name} валидна: "${url}"`);
      }
    }
  });
}
