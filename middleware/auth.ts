import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../src/logger";

export interface AuthenticatedRequest extends Request {
  user?: any;
}

export const PUBLIC_PATHS = ['/api/health', '/health', '/metrics', '/api/sync-status', '/api/readiness', '/api/calculator/eval'];

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
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

