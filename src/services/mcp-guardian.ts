import crypto from "crypto";
import { sqliteDb } from "../../db";
import { logger } from "../logger";

// Hardcoded Whitelist of allowed MCP tools
export const ALLOWED_MCP_TOOLS = new Set([
  "read_file",
  "write_file",
  "execute_sql",
  "kb_search",
  "smart_planner",
  "sales_analyzer",
  "web_search",
  "calculator",
  "generate_report",
  "translate_text"
]);

// Whitelisted domains for network-enabled tools
export const ALLOWED_DOMAINS = [
  "api.github.com",
  "generativelanguage.googleapis.com",
  "firestore.googleapis.com",
  "open.er-api.com"
];

export interface McpToolDefinition {
  name: string;
  description: string;
  parametersSchema: object;
}

export function computeToolHash(description: string, schema: object): string {
  const content = `${description}:${JSON.stringify(schema)}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function registerMcpTool(tool: McpToolDefinition, approvedBy: string = "system"): void {
  if (!ALLOWED_MCP_TOOLS.has(tool.name)) {
    logger.warn(`⚠️ MCP Tool Registration Rejected: Tool ${tool.name} is not in whitelist.`);
    return;
  }

  const hash = computeToolHash(tool.description, tool.parametersSchema);

  if (sqliteDb) {
    try {
      const existing = sqliteDb.prepare("SELECT hash FROM mcp_hashes WHERE tool_name = ?").get(tool.name);
      if (!existing) {
        sqliteDb.prepare(`
          INSERT INTO mcp_hashes (tool_name, hash, approved_by, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(tool.name, hash, approvedBy, new Date().toISOString());
        logger.info(`✅ MCP Tool registered & hashed: ${tool.name}`);
      } else if (existing.hash !== hash) {
        logger.error(`🚨 MCP TOOL POISONING ALERT: Hash mismatch detected for ${tool.name}! Registration requires explicit admin approval.`);
      }
    } catch (err) {
      logger.error("Failed to register MCP tool hash", { err });
    }
  }
}

export function verifyMcpToolIntegrity(toolName: string, description: string, schema: object): { valid: boolean; reason?: string } {
  if (!ALLOWED_MCP_TOOLS.has(toolName)) {
    return { valid: false, reason: `Tool '${toolName}' is not whitelisted.` };
  }

  const currentHash = computeToolHash(description, schema);

  if (sqliteDb) {
    try {
      const stored = sqliteDb.prepare("SELECT hash FROM mcp_hashes WHERE tool_name = ?").get(toolName);
      if (!stored) {
        // First run auto-register
        registerMcpTool({ name: toolName, description, parametersSchema: schema });
        return { valid: true };
      }

      if (stored.hash !== currentHash) {
        logger.error(`🚨 MCP TOOL POISONING PREVENTED: Tool '${toolName}' schema/description modified without admin approval!`);
        return { valid: false, reason: `MCP Tool Poisoning Detected: Hash mismatch for '${toolName}'. Execution blocked.` };
      }
    } catch (err) {
      logger.error("Failed to verify MCP tool integrity", { err });
    }
  }

  return { valid: true };
}

export async function executeMcpSandbox<T>(
  toolName: string,
  params: any,
  fn: () => Promise<T>,
  timeoutMs: number = 10000
): Promise<T> {
  const startTime = Date.now();
  logger.info(`🔧 MCP Guardian: Executing tool '${toolName}' in sandbox`, { toolName, params });

  if (!ALLOWED_MCP_TOOLS.has(toolName)) {
    throw new Error(`MCP Guardian Error: Tool '${toolName}' is forbidden by whitelist policy.`);
  }

  // Timeout Promise wrapper
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`MCP Guardian Timeout: Tool '${toolName}' exceeded sandbox limit of ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([fn(), timeoutPromise]);
    clearTimeout(timer!);
    logger.info(`✅ MCP Guardian: Tool '${toolName}' completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    logger.error(`❌ MCP Guardian: Tool '${toolName}' execution failed or timed out`, { err });
    throw err;
  }
}
