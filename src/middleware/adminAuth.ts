import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { logger } from "../logger";

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function adminLoginHandler(req: Request, res: Response) {
  try {
    const { password } = req.body || {};
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("Admin login failed: JWT_SECRET is not configured");
      return res.status(500).json({ error: "JWT_SECRET is not configured" });
    }

    const expectedPassword = process.env.ADMIN_PASSWORD || secret.slice(0, 12);

    if (!expectedPassword) {
      logger.error("Admin login failed: No admin password configured");
      return res.status(401).json({ error: "No admin password configured" });
    }

    if (password && safeCompare(password, expectedPassword)) {
      const token = jwt.sign({ role: "admin" }, secret, { expiresIn: "24h", issuer: "selin-ai" });
      return res.json({ token });
    }

    logger.warn(`Failed admin login attempt from IP: ${req.ip}`);
    return res.status(401).json({ error: "Invalid password" });
  } catch (err: any) {
    logger.error("Admin login error", { error: err });
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

export function adminGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn(`Unauthorized access attempt: Missing or invalid token header from IP: ${req.ip}`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("adminGuard: JWT_SECRET is not configured");
      return res.status(500).json({ error: "JWT_SECRET is not configured" });
    }

    try {
      const decoded = jwt.verify(token, secret, { issuer: "selin-ai" }) as any;
      if (decoded && decoded.role === "admin") {
        return next();
      }
      logger.warn(`Unauthorized access attempt: Invalid token claims from IP: ${req.ip}`);
      return res.status(401).json({ error: "Unauthorized" });
    } catch (err: any) {
      logger.warn(`Unauthorized access attempt: Token verification failed from IP: ${req.ip}. Error: ${err.message}`);
      return res.status(401).json({ error: "Unauthorized" });
    }
  } catch (err: any) {
    logger.error("adminGuard unexpected error", { error: err });
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
