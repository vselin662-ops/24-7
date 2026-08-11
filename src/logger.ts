export interface LogContext {
  tenantId?: string;
  requestId?: string;
  durationMs?: number;
  error?: any;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "jwt",
  "jwt_secret",
  "secret",
  "api_key",
  "apikey",
  "key",
  "password",
  "telegram_bot_token",
  "max_bot_token",
  "gemini_api_key",
  "bearer"
]);

function sanitizeData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("token") || lowerKey.includes("secret") || lowerKey.includes("key")) {
      sanitized[key] = "***MASKED***";
    } else if (value && typeof value === "object") {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

class Logger {
  private defaultContext: LogContext;

  constructor(defaultContext: LogContext = {}) {
    this.defaultContext = defaultContext;
  }

  public child(context: LogContext): Logger {
    return new Logger({ ...this.defaultContext, ...context });
  }

  private formatMessage(level: "info" | "warn" | "error", message: string, context: LogContext = {}): string {
    const merged = { ...this.defaultContext, ...context };
    const sanitized = sanitizeData(merged);

    const logEntry: Record<string, any> = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (sanitized.tenantId) logEntry.tenantId = sanitized.tenantId;
    if (sanitized.requestId) logEntry.requestId = sanitized.requestId;
    if (sanitized.durationMs !== undefined) logEntry.durationMs = sanitized.durationMs;

    if (sanitized.error) {
      if (sanitized.error instanceof Error) {
        logEntry.error = {
          name: sanitized.error.name,
          message: sanitized.error.message,
          stack: sanitized.error.stack,
        };
      } else {
        logEntry.error = sanitized.error;
      }
    }

    const { tenantId, requestId, durationMs, error, ...rest } = sanitized;
    if (Object.keys(rest).length > 0) {
      logEntry.details = rest;
    }

    return JSON.stringify(logEntry);
  }

  public info(message: string, context?: LogContext): void {
    console.log(this.formatMessage("info", message, context));
  }

  public warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage("warn", message, context));
  }

  public error(message: string, context?: LogContext): void {
    console.error(this.formatMessage("error", message, context));
  }
}

export const logger = new Logger();
