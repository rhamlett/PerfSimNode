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
 * Skips logging internal probe requests (marked with X-Internal-Probe header)
 * to reduce log noise. These are the native HTTP probes for dashboard latency.
 * Curl probes (which appear in AppLens) and all other requests are logged.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  // Skip logging for internal probe requests (native HTTP probes for dashboard)
  // unless they error - curl probes will still be logged for AppLens visibility
  const isInternalProbe = req.headers['x-internal-probe'] === 'true';

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const isError = res.statusCode >= 400;
    const timestamp = new Date().toISOString();
    
    // Skip internal probe logs unless error
    if (isInternalProbe && !isError) {
      return;
    }

    const logMessage = `[${timestamp}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

    if (isError) {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  });

  next();
}
