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
 *   Internal probe requests (from the sidecar process and dashboard heartbeat)
 *   are filtered out to reduce log noise. These are identified by:
 *   - X-Internal-Probe header (set by internal monitoring)
 *   - Localhost requests to /api/metrics/probe (sidecar probes)
 *
 *   External probe requests (via Azure's public URL) are NOT filtered —
 *   they should appear in Azure AppLens diagnostics.
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
