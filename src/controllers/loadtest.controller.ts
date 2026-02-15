/**
 * =============================================================================
 * LOAD TEST CONTROLLER — Azure Load Testing Integration REST API
 * =============================================================================
 *
 * PURPOSE:
 *   Provides a load test endpoint designed for automated load testing tools
 *   (Azure Load Testing, JMeter, k6, Gatling). Unlike other simulation
 *   endpoints, this does NOT appear in the dashboard UI.
 *
 * ENDPOINTS:
 *   GET /api/loadtest       → Execute load test work (all params optional query params)
 *   GET /api/loadtest/stats → Current statistics without performing work
 *
 * DEGRADATION BEHAVIOR:
 *   The endpoint degrades gracefully as concurrency increases:
 *   - Below soft limit:  ~baselineDelayMs response time (default 1000ms)
 *   - At soft limit:     Response time starts increasing
 *   - Above soft limit:  baselineDelayMs + (concurrent - softLimit) * degradationFactor
 *   - Extreme load:      Responses approach 230s Azure App Service frontend timeout
 *
 * QUERY PARAMETERS (all optional with defaults):
 *   - workIterations   (default: 700)    → CPU work per cycle (ms = value/10)
 *   - bufferSizeKb     (default: 100000) → Memory held per request
 *   - baselineDelayMs  (default: 1000)   → Minimum request duration
 *   - softLimit        (default: 20)     → Max concurrent before degradation
 *   - degradationFactor (default: 1000)  → Delay per request over limit
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
 * - workIterations (default: 700)     CPU work intensity (ms per cycle = workIterations/10)
 * - bufferSizeKb  (default: 100000)   Memory buffer held for request duration in KB
 * - baselineDelayMs (default: 1000)   Minimum request duration in ms
 * - softLimit     (default: 20)       Concurrent requests before degradation begins
 * - degradationFactor (default: 1000) Additional delay (ms) per request over soft limit
 *
 * Total delay formula:
 *   totalDelay = baselineDelayMs + max(0, currentConcurrent - softLimit) * degradationFactor
 *
 * Example scenarios (with defaults):
 *   1 concurrent request  → 1000ms baseline only
 *   10 concurrent requests → 1000 + (10-20)*1000 = 1000ms (still under limit)
 *   30 concurrent requests → 1000 + (30-20)*1000 = 11000ms total
 *   50 concurrent requests → 1000 + (50-20)*1000 = 31000ms total
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
