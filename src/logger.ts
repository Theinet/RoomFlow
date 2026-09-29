import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type LogFields = Record<string, boolean | number | string | undefined>;

function write(level: 'error' | 'info', event: string, fields: LogFields = {}) {
  console[level](JSON.stringify({
    at: new Date().toISOString(),
    level,
    event,
    ...fields,
  }));
}

export function logInfo(event: string, fields?: LogFields) {
  write('info', event, fields);
}

export function logError(event: string, error: unknown, fields?: LogFields) {
  const details = error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorName: 'UnknownError' };
  write('error', event, { ...fields, ...details });
}

/** Emits a privacy-safe access log. It intentionally excludes query strings and headers. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-ID', requestId);
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logInfo('http.request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    });
  });
  next();
}
