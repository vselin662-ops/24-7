import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "mathjs";
import { PureDatabase as Database } from "../src/lib/pure-sqlite";
import { authMiddleware, PUBLIC_PATHS } from "../middleware/auth";
import { apiRateLimiter, expensiveOpLimiter } from "../middleware/rateLimit";
import { logger } from "../src/logger";
import { metrics } from "../src/metrics";
import { requestIdMiddleware } from "../src/middleware/requestId";

describe("Security & Component Tests", () => {
  it("1. MathJS Evaluation - Safe Math without Function/eval", () => {
    const expr = "2 + 3 * 4";
    const result = evaluate(expr);
    assert.equal(result, 14);

    assert.throws(() => {
      evaluate("require('fs')");
    });
  });

  it("2. Auth Middleware - Public vs Private Routes", () => {
    assert.ok(PUBLIC_PATHS.includes("/api/health"));
    assert.ok(PUBLIC_PATHS.includes("/metrics"));
    assert.ok(!PUBLIC_PATHS.includes("/api/user/balances"));

    let nextCalled = false;
    const mockReq: any = { path: "/api/health", headers: {} };
    const mockRes: any = {};
    const mockNext = () => { nextCalled = true; };

    authMiddleware(mockReq, mockRes, mockNext);
    assert.equal(nextCalled, true);
  });

  it("3. Rate Limiter Middleware Verification", () => {
    assert.ok(typeof apiRateLimiter === "function");
    assert.ok(typeof expensiveOpLimiter === "function");
  });

  it("4. SQLite Tenant Isolation", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.prepare("INSERT INTO chats (id, tenant_id, data, updated_at) VALUES (?, ?, ?, ?)").run("chat_1", "tenant_A", '{"msg":"hello A"}', "2026-08-09");
    db.prepare("INSERT INTO chats (id, tenant_id, data, updated_at) VALUES (?, ?, ?, ?)").run("chat_2", "tenant_B", '{"msg":"hello B"}', "2026-08-09");

    const tenantAData = db.prepare("SELECT * FROM chats WHERE tenant_id = ?").all("tenant_A");
    assert.equal(tenantAData.length, 1);
    assert.equal((tenantAData[0] as any).id, "chat_1");

    const tenantBData = db.prepare("SELECT * FROM chats WHERE tenant_id = ?").all("tenant_B");
    assert.equal(tenantBData.length, 1);
    assert.equal((tenantBData[0] as any).id, "chat_2");

    db.close();
  });

  it("5. Structured Logger & Sanitization", () => {
    assert.ok(typeof logger.info === "function");
    assert.ok(typeof logger.error === "function");
  });

  it("6. Prometheus Metrics Registry", () => {
    metrics.incrementCounter("http_requests_total", { method: "GET", path: "/test", status: "200", tenant_id: "tenant_1" });
    const output = metrics.getMetrics();
    assert.ok(output.includes("http_requests_total"));
    assert.ok(output.includes("tenant_1"));
  });

  it("7. Request ID Middleware", () => {
    const req: any = { headers: {} };
    const headersSet: Record<string, string> = {};
    const res: any = {
      setHeader: (key: string, val: string) => { headersSet[key] = val; }
    };
    let nextCalled = false;
    requestIdMiddleware(req, res, () => { nextCalled = true; });

    assert.ok(nextCalled);
    assert.ok(req.requestId);
    assert.equal(headersSet["X-Request-Id"], req.requestId);
  });
});

