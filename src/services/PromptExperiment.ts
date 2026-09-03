import { redisService } from "./RedisService";
import { sqliteDb } from "../../db";
import { promptVariantSelected } from "../metrics/prometheus";
import { logger } from "../logger";

export class PromptExperiment {
  private static isTableInitialized = false;

  constructor() {
    PromptExperiment.initializeTable();
  }

  /**
   * Automatically initializes the SQLite table for logging experiments if it doesn't exist.
   */
  private static initializeTable() {
    if (this.isTableInitialized) return;
    try {
      if (sqliteDb) {
        sqliteDb.exec(`
          CREATE TABLE IF NOT EXISTS prompt_experiments (
            chat_id TEXT NOT NULL,
            experiment_name TEXT NOT NULL,
            variant TEXT NOT NULL,
            selected_at TEXT NOT NULL,
            PRIMARY KEY (chat_id, experiment_name)
          );
        `);
        this.isTableInitialized = true;
        logger.info("📊 [PromptExperiment] SQLite table 'prompt_experiments' initialized successfully.");
      } else {
        logger.warn("⚠️ [PromptExperiment] sqliteDb is not available for initialization.");
      }
    } catch (err: any) {
      logger.error(`❌ [PromptExperiment] Failed to initialize SQLite table: ${err?.message}`);
    }
  }

  /**
   * Retrieves the assigned variant (A or B etc) for a chatId within a specific experiment.
   * Ensures absolute consistency by caching the choice in Redis (30-day TTL) and persistent SQLite log.
   * 
   * @param chatId Unique identifier of the user/chat.
   * @param experimentName The name of the A/B experiment.
   * @param weights An optional object containing variant weights (e.g. { A: 0.7, B: 0.3 }). Defaults to 50/50.
   */
  public async getVariant(
    chatId: string,
    experimentName: string,
    weights: Record<string, number> = { A: 0.5, B: 0.5 }
  ): Promise<string> {
    // 1. Ensure table is initialized
    PromptExperiment.initializeTable();

    const redisKey = `exp:${experimentName}:${chatId}`;

    // 2. Try to get existing variant from Redis
    try {
      if (redisService.isAvailable()) {
        const cachedVariant = await redisService.get(redisKey);
        if (cachedVariant) {
          // Increment the Prometheus metric for consistent monitoring
          promptVariantSelected.inc({ experiment: experimentName, variant: cachedVariant });
          return cachedVariant;
        }
      }
    } catch (err: any) {
      logger.warn(`⚠️ [PromptExperiment] Redis read failed: ${err?.message}`);
    }

    // 3. Fallback to SQLite check if Redis was empty/unavailable to prevent split-brain selection
    try {
      if (sqliteDb) {
        const row = sqliteDb.prepare(
          "SELECT variant FROM prompt_experiments WHERE chat_id = ? AND experiment_name = ?"
        ).get(chatId, experimentName);

        if (row && row.variant) {
          const storedVariant = row.variant;
          // Re-populate Redis cache asynchronously for future fast reads
          if (redisService.isAvailable()) {
            redisService.set(redisKey, storedVariant, 30 * 24 * 60 * 60).catch(() => {});
          }
          promptVariantSelected.inc({ experiment: experimentName, variant: storedVariant });
          return storedVariant;
        }
      }
    } catch (err: any) {
      logger.error(`❌ [PromptExperiment] SQLite check failed: ${err?.message}`);
    }

    // 4. No previous assignment found. Decide new variant based on weights
    const variants = Object.keys(weights);
    if (variants.length === 0) {
      throw new Error(`[PromptExperiment] Weights object cannot be empty for experiment: ${experimentName}`);
    }

    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) {
      throw new Error(`[PromptExperiment] Total weight must be greater than zero for experiment: ${experimentName}`);
    }

    let r = Math.random() * totalWeight;
    let chosenVariant = variants[0];

    for (const variant of variants) {
      r -= weights[variant];
      if (r <= 0) {
        chosenVariant = variant;
        break;
      }
    }

    const selectedAt = new Date().toISOString();

    // 5. Persist the chosen variant in SQLite
    try {
      if (sqliteDb) {
        sqliteDb.prepare(`
          INSERT OR REPLACE INTO prompt_experiments (chat_id, experiment_name, variant, selected_at)
          VALUES (?, ?, ?, ?)
        `).run(chatId, experimentName, chosenVariant, selectedAt);
      }
    } catch (err: any) {
      logger.error(`❌ [PromptExperiment] Failed to save variant in SQLite: ${err?.message}`);
    }

    // 6. Persist the chosen variant in Redis (30 days TTL = 2592000 seconds)
    try {
      if (redisService.isAvailable()) {
        await redisService.set(redisKey, chosenVariant, 30 * 24 * 60 * 60);
      }
    } catch (err: any) {
      logger.warn(`⚠️ [PromptExperiment] Failed to cache variant in Redis: ${err?.message}`);
    }

    // 7. Increment Prometheus Counter metric
    try {
      promptVariantSelected.inc({ experiment: experimentName, variant: chosenVariant });
    } catch (err: any) {
      logger.warn(`⚠️ [PromptExperiment] Prometheus instrumentation failed: ${err?.message}`);
    }

    logger.info(`📊 [PromptExperiment] Assigned variant '${chosenVariant}' for chat ${chatId} in experiment '${experimentName}'`);
    return chosenVariant;
  }
}

export const promptExperiment = new PromptExperiment();
