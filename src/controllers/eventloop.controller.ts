/**
 * =============================================================================
 * EVENT LOOP CONTROLLER — Event Loop Blocking Simulation REST API
 * =============================================================================
 *
 * PURPOSE:
 *   REST endpoint for blocking the event loop. The request blocks server-side
 *   for the specified duration and returns only AFTER the blocking completes.
 *   This means the HTTP response time equals the blocking duration.
 *
 * ENDPOINTS:
 *   POST /api/simulations/eventloop → Block event loop (body: durationSeconds, optional chunkMs)
 *
 * BLOCKING BEHAVIOR:
 *   Unlike CPU and memory simulations which start in the background and return
 *   immediately, this endpoint is synchronous from the client's perspective.
 *   The Express handler awaits EventLoopBlockService.block(), which runs the
 *   blocking simulation in the main thread. The response is sent after the
 *   simulation completes, making the HTTP response time a direct measure of
 *   the blocking duration.
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
eventloopRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input parameters
    const { durationSeconds } = validateEventLoopBlockingParams(req.body.durationSeconds);
    const chunkMs = req.body.chunkMs != null
      ? Math.max(50, Math.min(2000, parseInt(req.body.chunkMs, 10) || 200))
      : undefined;

    // Block the event loop in chunks (async - yields briefly between chunks)
    const simulation = await EventLoopBlockService.block({ durationSeconds, chunkMs });

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
