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
 * Skips logging internal probe requests to reduce log noise:
 * - Native HTTP probes (marked with X-Internal-Probe header)
 * - Any localhost requests to /api/metrics/probe
 * Curl probes (which go through external HTTPS) appear in AppLens.
 *
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  // Skip logging for internal probe requests (native HTTP probes for dashboard)
  // Check both the header AND the path+source to catch all internal probes
  const isInternalProbe = req.headers['x-internal-probe'] === 'true';
  const isProbeEndpoint = req.originalUrl === '/api/metrics/probe';
  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  const isInternalProbeRequest = isInternalProbe || (isProbeEndpoint && isLocalhost);

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
