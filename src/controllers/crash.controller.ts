/**
 * =============================================================================
 * CRASH CONTROLLER — Crash Simulation REST API
 * =============================================================================
 *
 * PURPOSE:
 *   REST endpoints for intentionally crashing the process via different failure
 *   modes. Each crash type produces a different diagnostic signature in
 *   monitoring tools.
 *
 * ENDPOINTS:
 *   POST /api/simulations/crash/failfast      → SIGABRT (process.abort)
 *   POST /api/simulations/crash/stackoverflow → Infinite recursion crash
 *   POST /api/simulations/crash/exception     → Unhandled exception
 *   POST /api/simulations/crash/memory        → OOM (allocate until crash)
 *
 * RESPONSE PATTERN:
 *   All endpoints return HTTP 202 (Accepted) with a warning message BEFORE
 *   the crash is triggered. The crash happens asynchronously via setImmediate,
 *   giving the response time to be sent. However, the client may still see
 *   a connection reset if the response hasn't fully flushed.
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
 * POST /api/simulations/crash/failfast
 *
 * Triggers a FailFast crash (process.abort / SIGABRT).
 *
 * WARNING: This will immediately terminate the Node.js process.
 *
 * @route POST /api/simulations/crash/failfast
 * @returns {Object} Crash initiated message (may not be received)
 */
crashRouter.post('/failfast', (_req: Request, res: Response) => {
  res.status(202).json({
    message: 'FailFast initiated - process will terminate via SIGABRT',
    warning: 'The process will terminate immediately. In Azure App Service, it will restart automatically.',
    timestamp: new Date().toISOString(),
  });

  CrashService.crashWithFailFast();
});

/**
 * POST /api/simulations/crash/stackoverflow
 *
 * Triggers a stack overflow crash via infinite recursion.
 *
 * WARNING: This will terminate the Node.js process.
 *
 * @route POST /api/simulations/crash/stackoverflow
 * @returns {Object} Crash initiated message (may not be received)
 */
crashRouter.post('/stackoverflow', (_req: Request, res: Response) => {
  res.status(202).json({
    message: 'Stack overflow initiated - process will terminate via infinite recursion',
    warning: 'The process will terminate. In Azure App Service, it will restart automatically.',
    timestamp: new Date().toISOString(),
  });

  CrashService.crashWithStackOverflow();
});

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
