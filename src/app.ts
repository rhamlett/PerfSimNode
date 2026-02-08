/**
 * Express Application Configuration
 *
 * Configures Express middleware, routes, and error handling.
 *
 * @module app
 */

import express, { Application, Request, Response } from 'express';
import path from 'path';
import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { healthRouter } from './controllers/health.controller';
import { metricsRouter } from './controllers/metrics.controller';
import { cpuRouter } from './controllers/cpu.controller';
import { adminRouter } from './controllers/admin.controller';
import { memoryRouter } from './controllers/memory.controller';
import { eventloopRouter } from './controllers/eventloop.controller';
import { slowRouter } from './controllers/slow.controller';
import { crashRouter } from './controllers/crash.controller';

/**
 * Creates and configures the Express application.
 *
 * @returns Configured Express application instance
 */
export function createApp(): Application {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLogger);

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, 'public')));

  // API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/api/simulations/cpu', cpuRouter);
  app.use('/api/simulations/memory', memoryRouter);
  app.use('/api/simulations/eventloop', eventloopRouter);
  app.use('/api/simulations/slow', slowRouter);
  app.use('/api/simulations/crash', crashRouter);
  app.use('/api', adminRouter); // Handles /api/simulations, /api/admin/status, /api/admin/events

  // 404 handler for unmatched routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource does not exist',
    });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
