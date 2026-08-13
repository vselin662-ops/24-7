import { sqliteDb } from "../../db";
import { logger } from "../logger";

// 50+ Known Jailbreak and Prompt Injection Attack Patterns
export const JAILBREAK_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /Do\s+Anything\s+Now/i, description: "DAN Jailbreak" },
  { pattern: /\bDAN\s+mode\b/i, description: "DAN Mode activation" },
  { pattern: /Developer\s+Mode\s+enabled/i, description: "Developer Mode exploit" },
  { pattern: /my\s+grandmother\s+used\s+to\s+read\s+me/i, description: "Grandmother storytelling bypass" },
  { pattern: /my\s+grandmother\s+would\s+always/i, description: "Grandmother roleplay exploit" },
  { pattern: /act\0*\s*as\s*a\s*jailbroken/i, description: "Jailbroken AI persona" },
  { pattern: /you\s+are\s+now\s+unfiltered/i, description: "Unfiltered mode bypass" },
  { pattern: /ignore\s+all\s+(previous|prior)\s+(instructions|directives|rules)/i, description: "Instruction override" },
  { pattern: /disregard\s+(all|your)\s+(safety|core)\s+(guidelines|instructions|rules)/i, description: "Guideline override" },
  { pattern: /forget\s+(all\s+)?your\s+rules/i, description: "Rule wiping attempt" },
  { pattern: /override\s+(all\s+)?safety/i, description: "Safety override command" },
  { pattern: /bypass\s+(all\s+)?security\s+protocols/i, description: "Protocol bypass attempt" },
  { pattern: /pretend\s+you\s+have\s+no\s+(rules|ethics|morals|limits)/i, description: "Ethics removal roleplay" },
  { pattern: /simulate\s+a\s+(malicious|hacked|evil|unrestricted)/i, description: "Malicious persona simulation" },
  { pattern: /AIM\s+mode/i, description: "Always Intelligent and Machiavellian mode" },
  { pattern: /CARV\s+mode/i, description: "CARV Jailbreak" },
  { pattern: /STAN\s+mode/i, description: "Strive To Avoid Norms jailbreak" },
  { pattern: /DUDE\s+mode/i, description: "DUDE jailbreak" },
  { pattern: /hypothetical\s+response\s+without\s+refusal/i, description: "Hypothetical bypass" },
  { pattern: /for\s+educational\s+and\s+research\s+purposes\s+only,?\s+ignore\s+safety/i, description: "Educational framing bypass" },
  { pattern: /write\s+a\s+python\s+script\s+to\s+(hack|exploit|bypass)/i, description: "Exploit code request" },
  { pattern: /encode\s+your\s+response\s+in\s+(base64|hex|rot13)/i, description: "Encoding obfuscation" },
  { pattern: /decode\s+this\s+base64\s+and\s+execute/i, description: "Base64 execution payload" },
  { pattern: /translate\s+from\s+leetspeak\s+and\s+follow/i, description: "Leetspeak obfuscation" },
  { pattern: /new\s+system\s+prompt:/i, description: "System prompt injection prefix" },
  { pattern: /\[SYSTEM\s*NOTE:/i, description: "Fake system note injection" },
  { pattern: /\[ADMIN\s*OVERRIDE\]/i, description: "Fake admin override" },
  { pattern: /<\s*system_instructions\s*>/i, description: "XML tag system injection" },
  { pattern: /<<SYS>>/i, description: "Llama SYS tag injection" },
  { pattern: /\[INST\]\s*<<SYS>>/i, description: "Llama instruction override" },
  { pattern: /you\s+are\s+an\s+AI\s+without\s+boundaries/i, description: "No boundaries persona" },
  { pattern: /unrestricted\s+mode\s+activated/i, description: "Mode activation trigger" },
  { pattern: /turn\s+off\s+your\s+content\s+filters/i, description: "Content filter disable request" },
  { pattern: /disable\s+safety\s+filter/i, description: "Safety filter disable request" },
  { pattern: /reveal\s+(your\s+)?(initial|full|system)\s+prompt/i, description: "System prompt extraction" },
  { pattern: /repeat\s+everything\s+above\s+this\s+line/i, description: "Prompt leak repeat request" },
  { pattern: /output\s+the\s+text\s+above\s+verbatim/i, description: "Verbatim system prompt leak" },
  { pattern: /what\s+are\s+your\s+exact\s+system\s+instructions/i, description: "System instruction extraction" },
  { pattern: /show\s+me\s+your\s+hidden\s+rules/i, description: "Hidden rules disclosure" },
  { pattern: /print\s+your\s+initial\s+instructions/i, description: "Initial instruction print request" },
  { pattern: /sudo\s+mode/i, description: "Sudo privilege escalation roleplay" },
  { pattern: /god\s+mode\s+enabled/i, description: "God mode jailbreak" },
  { pattern: /root\s+access\s+granted/i, description: "Root access roleplay" },
  { pattern: /bypass_filter\s*=\s*true/i, description: "Code-like flag manipulation" },
  { pattern: /safety_enabled\s*=\s*false/i, description: "Safety flag modification attempt" },
  { pattern: /jailbreak_status\s*:\s*active/i, description: "Jailbreak status assertion" },
  { pattern: /anti-GPT\s+mode/i, description: "Anti-GPT persona" },
  { pattern: /Opposite\s+Mode/i, description: "Opposite day/mode jailbreak" },
  { pattern: /Evil\s+Twin\s+persona/i, description: "Evil twin persona escape" },
  { pattern: /ChaosGPT/i, description: "Chaos persona trigger" },
  { pattern: /nevermind\s+your\s+safety\s+guidelines/i, description: "Safety directive dismissal" },
  { pattern: /disregard\s+the\s+previous\s+context/i, description: "Context wipe attempt" }
];

export interface JailbreakCheckResult {
  isJailbreak: boolean;
  isBlocked: boolean;
  matchedPattern?: string;
  reason?: string;
  blockedUntil?: number;
}

export function checkJailbreak(tenantId: string, text: string): JailbreakCheckResult {
  if (!text) return { isJailbreak: false, isBlocked: false };

  const now = Date.now();

  // Check if tenant is currently blocked in DB
  if (sqliteDb) {
    try {
      const row = sqliteDb.prepare("SELECT blocked_until, count, last_attempt_at FROM jailbreak_log WHERE tenant_id = ?").get(tenantId);
      if (row && row.blocked_until > now) {
        return {
          isJailbreak: true,
          isBlocked: true,
          reason: `User is temporarily blocked until ${new Date(row.blocked_until).toISOString()} due to multiple jailbreak attempts.`,
          blockedUntil: row.blocked_until
        };
      }
    } catch (e) {
      logger.error("Error reading jailbreak_log table", { e });
    }
  }

  // Scan text for patterns
  for (const item of JAILBREAK_PATTERNS) {
    if (item.pattern.test(text)) {
      logger.warn(`🚨 JAILBREAK PATTERN DETECTED: ${item.description}`, { tenantId });
      
      let count = 1;
      let blockedUntil = 0;

      if (sqliteDb) {
        try {
          const row = sqliteDb.prepare("SELECT count, last_attempt_at FROM jailbreak_log WHERE tenant_id = ?").get(tenantId);
          if (row) {
            // Reset counter if last attempt was over 1 hour ago
            const oneHour = 60 * 60 * 1000;
            if (now - row.last_attempt_at > oneHour) {
              count = 1;
            } else {
              count = row.count + 1;
            }
          }

          // If counter > 3 within 1 hour -> 24h block
          if (count > 3) {
            blockedUntil = now + (24 * 60 * 60 * 1000);
          }

          sqliteDb.prepare(`
            INSERT INTO jailbreak_log (tenant_id, count, last_attempt_at, blocked_until)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(tenant_id) DO UPDATE SET
              count = excluded.count,
              last_attempt_at = excluded.last_attempt_at,
              blocked_until = excluded.blocked_until
          `).run(tenantId, count, now, blockedUntil);

          // Log to security_audit
          const auditId = `sec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          sqliteDb.prepare(`
            INSERT INTO security_audit (id, tenant_id, event_type, details, risk_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            auditId,
            tenantId,
            "JAILBREAK_ATTEMPT",
            JSON.stringify({ pattern: item.description, count, blockedUntil }),
            80.0,
            new Date().toISOString()
          );
        } catch (e) {
          logger.error("Error updating jailbreak_log", { e });
        }
      }

      return {
        isJailbreak: true,
        isBlocked: count > 3,
        matchedPattern: item.description,
        reason: "Я не могу выполнить эту просьбу. Я — Selin AI, ваш бизнес-ассистент.",
        blockedUntil
      };
    }
  }

  return { isJailbreak: false, isBlocked: false };
}
