import rateLimit from "express-rate-limit";
import { metrics } from "../src/metrics";

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 200, // максимум 200 запросов с одного IP в течение 15 минут
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    return req.ip || (req.headers["x-forwarded-for"] as string) || "127.0.0.1";
  },
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
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    return req.ip || (req.headers["x-forwarded-for"] as string) || "127.0.0.1";
  },
  handler: (req, res, next, options) => {
    metrics.incrementCounter("rate_limit_hits_total", { limiter: "expensiveOpLimiter" });
    res.status(options.statusCode).json(options.message);
  },
  message: { error: "Rate limit exceeded for this operation" }
});


