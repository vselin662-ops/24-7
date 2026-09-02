import rateLimit from "express-rate-limit";
import { metrics } from "../metrics";

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
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
    error: "Too many requests, please try again after 15 minutes."
  }
});

export const expensiveOpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
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
  message: {
    error: "Too many expensive operations, please try again after a minute."
  }
});

export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    return req.ip || (req.headers["x-forwarded-for"] as string) || "127.0.0.1";
  },
  handler: (req, res, next, options) => {
    metrics.incrementCounter("rate_limit_hits_total", { limiter: "webhookLimiter" });
    res.status(options.statusCode).json(options.message);
  },
  message: {
    error: "Webhook rate limit exceeded."
  }
});

// Alias for Webhook rate limiters
export const Webhook = webhookLimiter;
export const webhook = webhookLimiter;
