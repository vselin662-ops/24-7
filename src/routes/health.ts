import { Router, Request, Response } from "express";
import { sqliteDb } from "../../db";
import { redisService } from "../services/RedisService";
import { logger } from "../logger";

const healthRouter = Router();

/**
 * GET /api/health
 * Thorough health check endpoint that verifies SQL, Redis, and RAM usage.
 */
healthRouter.get("/health", async (req: Request, res: Response) => {
  const status: any = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      sqlite: "unknown",
      redis: "unknown",
      memory: "unknown"
    }
  };

  let hasError = false;

  // 1. Check SQLite
  try {
    if (sqliteDb) {
      const row = sqliteDb.prepare("SELECT 1 AS alive").get() as any;
      if (row && row.alive === 1) {
        status.services.sqlite = "healthy";
      } else {
        status.services.sqlite = "unhealthy";
        hasError = true;
      }
    } else {
      status.services.sqlite = "unavailable";
      hasError = true;
    }
  } catch (dbErr: any) {
    logger.error("❌ [Health] SQLite health check failed:", dbErr);
    status.services.sqlite = `unhealthy: ${dbErr.message || dbErr}`;
    hasError = true;
  }

  // 2. Check Redis
  try {
    if (redisService.isAvailable()) {
      await redisService.set("health_check_temp", "ok", 10);
      const val = await redisService.get("health_check_temp");
      if (val === "ok") {
        status.services.redis = "healthy";
      } else {
        status.services.redis = "unhealthy";
        hasError = true;
      }
    } else {
      status.services.redis = "unavailable";
      // If REDIS_URL is configured but Redis is unavailable, treat as error.
      if (process.env.REDIS_URL) {
        hasError = true;
      }
    }
  } catch (redisErr: any) {
    logger.error("❌ [Health] Redis health check failed:", redisErr);
    status.services.redis = `unhealthy: ${redisErr.message || redisErr}`;
    if (process.env.REDIS_URL) {
      hasError = true;
    }
  }

  // 3. Check Memory (RAM)
  const heapUsed = process.memoryUsage().heapUsed;
  const heapUsedMB = heapUsed / (1024 * 1024);
  status.services.memory = {
    heapUsedBytes: heapUsed,
    heapUsedMB: Math.round(heapUsedMB * 100) / 100,
    limitMB: 500,
    status: "healthy"
  };

  // Limit threshold: 500MB (500 * 1024 * 1024 bytes)
  const memoryLimit = 500 * 1024 * 1024;
  if (heapUsed > memoryLimit) {
    status.services.memory.status = "overload";
    hasError = true;
  }

  if (hasError) {
    status.status = "error";
    res.status(500).json(status);
  } else {
    res.status(200).json(status);
  }
});

export { healthRouter };
