import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function adminLoginHandler(req: Request, res: Response) {
  try {
    const { password } = req.body || {};
    const expectedPassword = process.env.ADMIN_PASSWORD || (process.env.JWT_SECRET || "").slice(0, 12);

    if (!expectedPassword) {
      return res.status(401).json({ error: "No admin password configured" });
    }

    if (password === expectedPassword) {
      const secret = process.env.JWT_SECRET || "selin-fallback-jwt-secret-key-123";
      const token = jwt.sign({ role: "admin" }, secret, { expiresIn: "7d" });
      return res.json({ token });
    }

    return res.status(401).json({ error: "Invalid password" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

export function adminGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_SECRET || "selin-fallback-jwt-secret-key-123";

    try {
      const decoded = jwt.verify(token, secret) as any;
      if (decoded && decoded.role === "admin") {
        return next();
      }
      return res.status(401).json({ error: "Unauthorized" });
    } catch (err) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
