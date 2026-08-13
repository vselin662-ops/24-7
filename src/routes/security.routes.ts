import { Router, Request, Response } from "express";
import { sqliteDb } from "../../db";
import { logger } from "../logger";

const securityRouter = Router();

// Master Admin Key for Emergency Operations
const MASTER_KEY = process.env.SECURITY_MASTER_KEY || "selin_sec_master_key_2026";

/**
 * POST /api/security/killswitch
 * Triggers or resets Emergency Kill Switch
 */
securityRouter.post("/killswitch", (req: Request, res: Response) => {
  const { master_key, confirmation_code, action, reason } = req.body || {};

  if (master_key !== MASTER_KEY) {
    logger.warn("🚨 Unauthorized Killswitch Attempt!", { ip: req.ip });
    res.status(401).json({ error: "Unauthorized: Invalid Master Key" });
    return;
  }

  if (confirmation_code !== "CONFIRM_EMERGENCY_KILLSWITCH_2FA_2026") {
    res.status(400).json({ error: "Bad Request: Invalid 2FA Confirmation Code" });
    return;
  }

  if (action === "DISABLE") {
    (global as any).IS_EMERGENCY_KILLSWITCH_ACTIVE = false;
    logger.info("🟢 EMERGENCY KILLSWITCH DEACTIVATED BY ADMIN", { reason });
    
    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          INSERT INTO security_audit (id, tenant_id, event_type, details, risk_score, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`ks_${Date.now()}`, "admin", "KILLSWITCH_DEACTIVATED", reason || "Manual reset", 0, new Date().toISOString());
      } catch (e) {}
    }

    res.json({ status: "deactivated", message: "AI processing restored successfully." });
    return;
  }

  // Default action: ENABLE KILLSWITCH
  (global as any).IS_EMERGENCY_KILLSWITCH_ACTIVE = true;
  logger.error("🚨 EMERGENCY KILLSWITCH ACTIVATED BY ADMIN!", { reason });

  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO security_audit (id, tenant_id, event_type, details, risk_score, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`ks_${Date.now()}`, "admin", "KILLSWITCH_ACTIVATED", reason || "Emergency override", 100, new Date().toISOString());
    } catch (e) {}
  }

  res.json({
    status: "activated",
    message: "EMERGENCY KILLSWITCH ENABLED. All AI operations are now suspended until further notice.",
    activeSince: new Date().toISOString()
  });
});

/**
 * GET /api/security/audit
 * Fetch recent security audit logs
 */
securityRouter.get("/audit", (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.includes(MASTER_KEY)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!sqliteDb) {
    res.json({ logs: [] });
    return;
  }

  try {
    const logs = sqliteDb.prepare("SELECT * FROM security_audit ORDER BY created_at DESC LIMIT 50").all();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

export default securityRouter;
