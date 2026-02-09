/**
 * Slow Request Controller
 *
 * Handles slow request simulation endpoints.
 *
 * @module controllers/slow
 */

import { Router, Request, Response, NextFunction } from 'express';
import { SlowRequestService } from '../services/slow-request.service';
import { validateOptionalInteger } from '../middleware/validation';
import { limits, defaults } from '../config';

/**
 * Express router for slow request simulation endpoints.
 */
export const slowRouter = Router();

/**
 * GET /api/simulations/slow
 *
 * Returns a response after an artificial delay.
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

    // Execute the slow request
    const simulation = await SlowRequestService.delay({ delaySeconds });

    res.json({
      id: simulation.id,
      type: simulation.type,
      message: `Response delayed by ${delaySeconds}s`,
      status: simulation.status,
      requestedDelaySeconds: delaySeconds,
      actualDurationMs: simulation.stoppedAt
        ? simulation.stoppedAt.getTime() - simulation.startedAt.getTime()
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
