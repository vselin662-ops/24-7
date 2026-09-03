import { sqliteDb } from "../../db";
import { logger } from "../logger";
import { checkOutputForCanary } from "./canary-tokens";
import { deductTrustScore } from "./trust-engine";

const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Google API Key", pattern: /AIzaSy[a-zA-Z0-9_\-]{33}/g },
  { name: "Generic API Key (sk-)", pattern: /sk-[a-zA-Z0-9]{20,}/g },
  { name: "GitHub Token", pattern: /ghp_[a-zA-Z0-9]{36}/g },
  { name: "JWT Token", pattern: /eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}/g },
  { name: "Private Key Header", pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g },
];

export interface RequestContext {
  tenantId?: string;
  isOwner?: boolean;
  userPrompt?: string;
  voice_mode?: boolean;
}

export function filterAIOutput(response: string, context: RequestContext = {}): string {
  if (!response || typeof response !== 'string') return response;

  // Disable Output Filter for voice mode to avoid any clipping/truncating/blocking of vocalized books
  if (context.voice_mode === true || (context.userPrompt && /озвуч|прочитай|книг|глав|расскажи голосом|библи|ион/i.test(context.userPrompt))) {
    return response;
  }

  const tenantId = context.tenantId || 'default';
  let filtered = response;
  let exfiltrationDetected = false;
  let exfiltrationReason = '';

  // 1. Canary Token Check
  const canaryResult = checkOutputForCanary(filtered);
  if (canaryResult.leaked) {
    exfiltrationDetected = true;
    exfiltrationReason = `CANARY_TOKEN_LEAK (${canaryResult.matchedToken})`;
    filtered = "[REDACTED_SYSTEM_SECURITY_PROMPT]";
  }

  // 2. Sensitive Credential Patterns
  for (const item of SENSITIVE_PATTERNS) {
    if (item.pattern.test(filtered)) {
      exfiltrationDetected = true;
      exfiltrationReason = `CREDENTIAL_LEAK (${item.name})`;
      filtered = filtered.replace(item.pattern, "[REDACTED_SENSITIVE_CREDENTIAL]");
    }
  }

  // 3. System Prompt Leakage heuristic
  const lowerPrompt = (context.userPrompt || '').toLowerCase();
  const asksForSystemPrompt =
    lowerPrompt.includes("show your prompt") ||
    lowerPrompt.includes("what is your prompt") ||
    lowerPrompt.includes("tell me your system prompt") ||
    lowerPrompt.includes("покажи свой промт") ||
    lowerPrompt.includes("покажи системный промт");

  if (asksForSystemPrompt && (filtered.includes("Selin AI") || filtered.includes("Enterprise") || filtered.includes("инструкция"))) {
    exfiltrationDetected = true;
    exfiltrationReason = "SYSTEM_PROMPT_EXFILTRATION";
    filtered = "Я не обсуждаю эту тему.";
  }

  // 4. Handle Incident Logging & Penalties
  if (exfiltrationDetected) {
    logger.error(`🚨 OUTPUT EXFILTRATION PREVENTED for tenant ${tenantId}! Reason: ${exfiltrationReason}`);

    if (sqliteDb) {
      try {
        const auditId = `audit_ex_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        sqliteDb.prepare(`
          INSERT INTO security_audit (id, tenant_id, event_type, details, risk_score, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          auditId,
          tenantId,
          "EXFILTRATION_PREVENTED",
          JSON.stringify({ reason: exfiltrationReason }),
          90.0,
          new Date().toISOString()
        );
      } catch (err) {
        logger.error("Failed to write exfiltration log to DB", { err });
      }
    }

    deductTrustScore(tenantId, 30, exfiltrationReason);
  }

  return filtered;
}
