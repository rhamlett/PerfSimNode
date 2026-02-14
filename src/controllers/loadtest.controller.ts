/**
 * Load Test Controller
 *
 * API endpoints for Azure Load Testing integration.
 * Provides a load test endpoint that degrades gracefully under high volume.
 *
 * Unlike other simulation endpoints, this one does NOT appear in the dashboard
 * UI and is meant for automated load testing scenarios only.
 *
 * Behavior under load:
 * - Low load (below soft limit): ~100ms response time
 * - Moderate load (at soft limit): 200-500ms as contention builds
 * - High load (above soft limit): Multi-second responses
 * - Extreme load: Responses approach 230s Azure timeout
 *
 * After 120s of processing, there is a 20% chance per check interval
 * that a random exception will be thrown.
 *
 * @module controllers/loadtest
 */

import { Router, Request, Response, NextFunction } from 'express';
import { LoadTestService } from '../services/load-test.service';

/**
 * Express router for load test endpoints.
 */
export const loadtestRouter = Router();

/**
 * GET /api/loadtest
 *
 * Executes a load test request with configurable resource consumption.
 * All parameters are optional query params with sensible defaults.
 *
 * Query Parameters:
 * - workIterations (default: 200)     CPU work intensity (ms per cycle = workIterations/10)
 * - bufferSizeKb  (default: 20000)    Memory buffer held for request duration in KB
 * - baselineDelayMs (default: 500)    Minimum request duration in ms
 * - softLimit     (default: 25)       Concurrent requests before degradation begins
 * - degradationFactor (default: 500)  Additional delay (ms) per request over soft limit
 *
 * Total delay formula:
 *   totalDelay = baselineDelayMs + max(0, currentConcurrent - softLimit) * degradationFactor
 *
 * Example scenarios (with defaults):
 *   1 concurrent request  → 500ms baseline only
 *   10 concurrent requests → 500 + (10-25)*500 = 500ms (still under limit)
 *   30 concurrent requests → 500 + (30-25)*500 = 3000ms total
 *   50 concurrent requests → 500 + (50-25)*500 = 13000ms total
 */
loadtestRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Parse query parameters (all optional, defaults applied by service)
    const request = {
      workIterations: parseOptionalInt(req.query.workIterations as string | undefined),
      bufferSizeKb: parseOptionalInt(req.query.bufferSizeKb as string | undefined),
      baselineDelayMs: parseOptionalInt(req.query.baselineDelayMs as string | undefined),
      softLimit: parseOptionalInt(req.query.softLimit as string | undefined),
      degradationFactor: parseOptionalInt(req.query.degradationFactor as string | undefined),
    };

    // Remove undefined values so service defaults apply
    const cleanRequest = Object.fromEntries(
      Object.entries(request).filter(([, v]) => v !== undefined)
    );

    const result = await LoadTestService.executeWork(cleanRequest);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/loadtest/stats
 *
 * Returns current load test statistics without performing work.
 * Useful for monitoring concurrent request count during load tests.
 */
loadtestRouter.get('/stats', (_req: Request, res: Response) => {
  const stats = LoadTestService.getCurrentStats();
  res.json(stats);
});

/**
 * Parses an optional integer from a query parameter value.
 * Returns undefined if the value is not present or not a valid integer.
 */
function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}
