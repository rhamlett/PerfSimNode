/**
 * Request Logger Middleware
 *
 * Logs incoming HTTP requests for debugging and monitoring.
 *
 * @module middleware/request-logger
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware.
 *
 * Logs method, URL, and response time for each request.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    const timestamp = new Date().toISOString();

    const logMessage = `[${timestamp}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

    if (logLevel === 'warn') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  });

  next();
}
