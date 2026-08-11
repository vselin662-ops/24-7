import { logger, LogContext } from "../logger";

export interface ConnectorResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  isFallback?: boolean;
  fallbackUrl?: string;
  message?: string;
  executedAt: string;
}

export abstract class BaseConnector<TParams = any, TResult = any> {
  public abstract readonly name: string;
  public abstract readonly description: string;

  /**
   * Main entry point for connector execution.
   */
  public async run(params: TParams, tenantId?: string): Promise<ConnectorResponse<TResult>> {
    const startTime = Date.now();
    const context: LogContext = { connector: this.name, tenantId };

    logger.info(`🔌 [ServiceConnector Execution Started] ${this.name}`, { ...context, params });

    try {
      const data = await this.execute(params, tenantId);
      const durationMs = Date.now() - startTime;
      logger.info(`✅ [ServiceConnector Succeeded] ${this.name}`, { ...context, durationMs });

      return {
        success: true,
        data,
        isFallback: false,
        executedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      logger.warn(`⚠️ [ServiceConnector Error - Triggering Fallback] ${this.name}: ${err.message || err}`, {
        ...context,
        durationMs,
        error: err,
      });

      try {
        const fallback = await this.handleFallback(params, err, tenantId);
        return {
          success: true,
          data: fallback.data,
          isFallback: true,
          fallbackUrl: fallback.fallbackUrl,
          message: fallback.message || "Обработано через резервный сценарий (Deep Link / Cache)",
          executedAt: new Date().toISOString(),
        };
      } catch (fallbackErr: any) {
        logger.error(`❌ [ServiceConnector Fallback Failed] ${this.name}: ${fallbackErr.message || fallbackErr}`, {
          ...context,
          error: fallbackErr,
        });

        return {
          success: false,
          error: fallbackErr.message || err.message || "Ошибка выполнения интеграции",
          isFallback: true,
          executedAt: new Date().toISOString(),
        };
      }
    }
  }

  /**
   * Core logic calling real API service. Should throw if API is unavailable or unconfigured.
   */
  protected abstract execute(params: TParams, tenantId?: string): Promise<TResult>;

  /**
   * Fallback logic (e.g. Deep link generation) when API is unreachable.
   */
  protected abstract handleFallback(
    params: TParams,
    error: Error,
    tenantId?: string
  ): Promise<{ data?: TResult; fallbackUrl?: string; message?: string }>;
}
