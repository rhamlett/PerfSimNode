/**
 * Event Loop Controller
 *
 * Handles event loop blocking simulation endpoints.
 *
 * @module controllers/eventloop
 */

import { Router, Request, Response, NextFunction } from 'express';
import { EventLoopBlockService } from '../services/eventloop-block.service';
import { validateEventLoopBlockingParams } from '../middleware/validation';

/**
 * Express router for event loop simulation endpoints.
 */
export const eventloopRouter = Router();

/**
 * POST /api/simulations/eventloop
 *
 * Blocks the event loop for the specified duration.
 *
 * WARNING: The server will be unresponsive during this simulation.
 * The response is sent AFTER the blocking completes.
 *
 * @route POST /api/simulations/eventloop
 * @body {number} durationSeconds - Duration to block in seconds (no limit)
 * @returns {SimulationCompletedResponse} Completed simulation details
 */
eventloopRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input parameters
    const { durationSeconds } = validateEventLoopBlockingParams(req.body.durationSeconds);

    // Block the event loop (synchronous - response sent after completion)
    const simulation = EventLoopBlockService.block({ durationSeconds });

    res.json({
      id: simulation.id,
      type: simulation.type,
      message: `Event loop was blocked for ${durationSeconds}s`,
      status: simulation.status,
      startedAt: simulation.startedAt.toISOString(),
      stoppedAt: simulation.stoppedAt?.toISOString(),
      actualDurationMs: simulation.stoppedAt
        ? simulation.stoppedAt.getTime() - simulation.startedAt.getTime()
        : null,
    });
  } catch (error) {
    next(error);
  }
});
