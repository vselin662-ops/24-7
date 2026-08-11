import rateLimit from "express-rate-limit";
import { metrics } from "../src/metrics";

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP в течение 15 минут
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    metrics.incrementCounter("rate_limit_hits_total", { limiter: "apiRateLimiter" });
    res.status(options.statusCode).json(options.message);
  },
  message: {
    error: "Too many requests from this IP, please try again later."
  }
});

export const expensiveOpLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    metrics.incrementCounter("rate_limit_hits_total", { limiter: "expensiveOpLimiter" });
    res.status(options.statusCode).json(options.message);
  },
  message: { error: "Rate limit exceeded for this operation" }
});

