import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

/** Error with an HTTP status that is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');
export const forbidden = (what = 'Forbidden') => new HttpError(403, what, 'forbidden');
export const unauthorized = (what = 'Not signed in') => new HttpError(401, what, 'unauthorized');
export const badRequest = (what: string, details?: unknown) => new HttpError(400, what, 'bad_request', details);
export const conflict = (what: string) => new HttpError(409, what, 'conflict');

/** Wrap async handlers so thrown errors reach the error middleware (Express 5 also does this). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation', message: 'Invalid request', details: err.issues.map((i) => ({ path: i.path, message: i.message })) },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Body parser errors (malformed JSON, too large)
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: (err as Error).message } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
}

/** A single string route/query param (Express 5 types allow arrays). */
export function param(req: Request, name: string): string | undefined {
  const v = (req.params as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : undefined;
}
