import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export interface RequestWithId extends Request {
  requestId?: string;
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction) {
  const existingId = req.headers["x-request-id"];
  const id = (typeof existingId === "string" && existingId.trim().length > 0)
    ? existingId
    : randomUUID();

  req.requestId = id;
  req.headers["x-request-id"] = id;
  res.setHeader("X-Request-Id", id);

  next();
}
