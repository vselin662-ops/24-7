import { Router } from "express";
import fs from "fs";
import path from "path";
import { sqliteDb } from "../../db";

const legalRouter = Router();

// 1. Health Status
legalRouter.get(["/api/health", "/health"], (_, res) => {
  res.json({
    status: "healthy",
    version: "2.1.0",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      database: !!sqliteDb ? "connected" : "disconnected",
      llm: "active",
      tts: "active"
    }
  });
});

// 2. Info Endpoint
legalRouter.get("/api/info", (_, res) => {
  res.json({
    name: "Selin AI",
    version: "2.1.0",
    author: "Selin Vadim",
    email: "vselin662@gmail.com",
    description: "Многомодульная ИИ-платформа и голосовой ассистент Selin AI",
    stack: ["Node.js", "Express", "TypeScript", "React", "Gemini 2.5 Flash", "Edge TTS", "MAX Messenger API", "SQLite WAL"],
    legal: {
      privacyPolicy: "/legal/PRIVACY_POLICY",
      termsOfService: "/legal/TERMS_OF_SERVICE",
      license: "/legal/LICENSE"
    }
  });
});

// 3. Legal Document Viewer
legalRouter.get("/legal/:docName", (req, res) => {
  const { docName } = req.params;
  const docsPath = path.join(process.cwd(), 'docs');
  const filePath = path.join(docsPath, `${docName}.md`);

  const allowedDocs = ['LICENSE', 'PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'ARCHITECTURE'];
  if (!allowedDocs.includes(docName.toUpperCase())) {
    return res.status(404).json({ error: "Document not found" });
  }

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      return res.send(content);
    } else {
      return res.status(404).json({ error: "File not found on server" });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error reading document" });
  }
});

export default legalRouter;
