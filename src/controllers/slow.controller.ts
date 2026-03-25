/**
 * =============================================================================
 * SLOW REQUEST CONTROLLER — Slow Request Simulation REST API
 * =============================================================================
 *
 * PURPOSE:
 *   REST endpoint for simulating slow HTTP responses with configurable blocking
 *   patterns. Uses GET method to allow easy testing from browsers.
 *
 * ENDPOINTS:
 *   GET /api/simulations/slow?delaySeconds=N&blockingPattern=P
 *     - delaySeconds: How long to delay (default: 5, configurable)
 *     - blockingPattern: setTimeout | libuv | worker (default: setTimeout)
 *
 * WHY GET (NOT POST):
 *   Using GET allows testing directly from the browser address bar and from
 *   the dashboard's slow request form without needing a POST body.
 *   The slow request simulation is idempotent (no side effects on resources),
 *   so GET is semantically acceptable.
 *
 * @module controllers/slow
 */

import { Router, Request, Response, NextFunction } from 'express';
import { SlowRequestService } from '../services/slow-request.service';
import { validateOptionalInteger } from '../middleware/validation';
import { limits, defaults } from '../config';
import { SlowRequestBlockingPattern } from '../types';

/**
 * Express router for slow request simulation endpoints.
 */
export const slowRouter = Router();

/**
 * Validates the blocking pattern parameter.
 * @param value - The pattern value to validate
 * @returns Valid blocking pattern or default
 */
const BLOCKING_PATTERNS: SlowRequestBlockingPattern[] = ['setTimeout', 'libuv', 'worker'];

function getRandomBlockingPattern(): SlowRequestBlockingPattern {
  return BLOCKING_PATTERNS[Math.floor(Math.random() * BLOCKING_PATTERNS.length)];
}

/**
 * GET /api/simulations/slow
 *
 * Returns a response after an artificial delay using the specified blocking pattern.
 *
 * This endpoint uses GET to allow easy testing from browsers.
 *
 * @route GET /api/simulations/slow
 * @query {number} delaySeconds - Delay in seconds (no limit, default: 5)
 * @returns {SlowRequestResponse} Response after delay
 */
slowRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input parameters (optional with default)
    const delaySeconds = validateOptionalInteger(
      req.query.delaySeconds,
      'delaySeconds',
      limits.minDurationSeconds,
      limits.maxDurationSeconds,
      defaults.slowRequestDelaySeconds
    );
    
    // Randomly select a blocking pattern
    const blockingPattern = getRandomBlockingPattern();

    // Execute the slow request
    const simulation = await SlowRequestService.delay({ delaySeconds, blockingPattern });

    res.json({
      id: simulation.id,
      type: simulation.type,
      message: `Response delayed by ${delaySeconds}s using ${blockingPattern} pattern`,
      status: simulation.status,
      requestedDelaySeconds: delaySeconds,
      blockingPattern,
      actualDurationMs: simulation.stoppedAt
        ? simulation.stoppedAt.getTime() - simulation.startedAt.getTime()
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
