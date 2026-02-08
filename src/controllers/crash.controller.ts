/**
 * Crash Controller
 *
 * Handles crash simulation endpoints.
 *
 * @module controllers/crash
 */

import { Router, Request, Response } from 'express';
import { CrashService } from '../services/crash.service';

/**
 * Express router for crash simulation endpoints.
 */
export const crashRouter = Router();

/**
 * POST /api/simulations/crash/exception
 *
 * Triggers an unhandled exception that will crash the process.
 *
 * WARNING: This will terminate the Node.js process.
 * In Azure App Service, the process will be automatically restarted.
 *
 * @route POST /api/simulations/crash/exception
 * @returns {Object} Crash initiated message (may not be received)
 */
crashRouter.post('/exception', (_req: Request, res: Response) => {
  // Send response before crashing
  res.status(202).json({
    message: 'Crash initiated - process will terminate via unhandled exception',
    warning: 'The process will terminate. In Azure App Service, it will restart automatically.',
    timestamp: new Date().toISOString(),
  });

  // Trigger crash after response is sent
  CrashService.crashWithException();
});

/**
 * POST /api/simulations/crash/memory
 *
 * Triggers memory exhaustion that will crash the process with OOM.
 *
 * WARNING: This will terminate the Node.js process with an out-of-memory error.
 *
 * @route POST /api/simulations/crash/memory
 * @returns {Object} Crash initiated message (may not be received)
 */
crashRouter.post('/memory', (_req: Request, res: Response) => {
  // Send response before crashing
  res.status(202).json({
    message: 'Memory exhaustion initiated - process will terminate with OOM error',
    warning: 'The process will terminate. In Azure App Service, it will restart automatically.',
    timestamp: new Date().toISOString(),
  });

  // Trigger crash after response is sent
  CrashService.crashWithMemoryExhaustion();
});
