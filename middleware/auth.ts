import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../src/logger";

export interface AuthenticatedRequest extends Request {
  user?: any;
}

export const PUBLIC_PATHS = [
  '/api/health',
  '/health',
  '/api/max/webhook',
  '/max/webhook',
  '/metrics',
  '/api/sync-status',
  '/sync-status',
  '/api/readiness',
  '/readiness',
  '/api/calculator/eval',
  '/calculator/eval',
  '/api/voice/transcribe',
  '/api/transcribe',
  '/api/tts',
  '/api/voice-organism-dialogue',
  '/api/get-voice-quest',
  '/api/interview',
  '/api/quest',
  '/api/feed',
  '/api/knowledge',
  '/api/mcp',
  '/api/moderation',
  '/api/get-config',
  '/api/agent-respond',
  '/api/launch',
  '/api/ai',
  '/api/telegram/webhook',
  '/telegram/webhook'
];

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const currentPath = (req.path || '').toLowerCase();
  const originalUrl = (req.originalUrl ? req.originalUrl.split('?')[0] : '').toLowerCase();
  const url = (req.url ? req.url.split('?')[0] : '').toLowerCase();
  const fullPath = ((req.baseUrl || '') + (req.path || '')).toLowerCase();

  const isPublic = PUBLIC_PATHS.some(p => {
    const target = p.toLowerCase();
    const matches = (
      currentPath === target ||
      currentPath.startsWith(target + '/') ||
      originalUrl === target ||
      originalUrl.startsWith(target + '/') ||
      url === target ||
      url.startsWith(target + '/') ||
      fullPath === target ||
      fullPath.startsWith(target + '/')
    );
    return matches;
  });

  console.log(`🔍 [Auth] path: ${currentPath}, isPublic: ${isPublic}`);

  if (isPublic) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing Authorization header" });
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    logger.error("CRITICAL ERROR: JWT_SECRET environment variable is not defined!");
    return res.status(500).json({ error: "Server authentication misconfigured" });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Forbidden: Invalid or expired token" });
  }
}

