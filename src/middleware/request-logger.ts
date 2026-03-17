/**
 * =============================================================================
 * REQUEST LOGGER MIDDLEWARE
 * =============================================================================
 *
 * PURPOSE:
 *   Logs every HTTP request with method, URL, status code, and response time.
 *   Provides visibility into API traffic for debugging and monitoring.
 *
 * FILTERING:
 *   During local development, sidecar probes to localhost are filtered out
 *   to reduce log noise. In Azure, all probes go through the public frontend
 *   and are logged normally (visible in AppLens diagnostics).
 *
 * PORTING NOTES:
 *   - Java Spring: Use a HandlerInterceptor or Filter
 *   - Python: Django middleware or FastAPI middleware
 *   - PHP: Laravel middleware
 *   - C#: ASP.NET middleware or IHttpLoggingMiddleware
 *   The key feature is measuring response time by hooking into the
 *   response lifecycle (record start time, log on response finish).
 *
 * @module middleware/request-logger
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Request logging middleware.
 *
 * Logs method, URL, and response time for each request.
 * Skips logging localhost probe requests to reduce local development noise.
 * In Azure, probes go through the public frontend and are logged normally.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  // Skip logging for localhost probe requests (local development only)
  // In Azure, all probes go through the public frontend and will be logged
  const isProbeEndpoint = req.originalUrl === '/api/metrics/probe';
  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const isInternalProbeRequest = isProbeEndpoint && isLocalhost;

  // Log when response finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const isError = res.statusCode >= 400;
    const timestamp = new Date().toISOString();
    
    // Skip internal probe logs unless error
    if (isInternalProbeRequest && !isError) {
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
