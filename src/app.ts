/**
 * =============================================================================
 * EXPRESS APPLICATION SETUP — HTTP Routing & Middleware Pipeline
 * =============================================================================
 *
 * PURPOSE:
 *   Creates and configures the Express web application with all middleware and
 *   API routes. This is the "wiring" layer — it doesn't contain business logic,
 *   just connects middleware → routes → controllers → services.
 *
 * MIDDLEWARE PIPELINE (order matters):
 *   1. Body parsing (JSON + URL-encoded)
 *   2. Request logging (timestamps, method, URL, status, duration)
 *   3. Static file serving (dashboard HTML/CSS/JS)
 *   4. API routes (health → metrics → simulations → admin)
 *   5. 404 handler (unmatched routes)
 *   6. Global error handler (catches all thrown errors, returns JSON)
 *
 * API ROUTE STRUCTURE:
 *   GET    /api/health            → Health check (used by Azure health probes)
 *   GET    /api/metrics           → Current system metrics snapshot
 *   GET    /api/metrics/probe     → Lightweight latency probe for sidecar
 *   POST   /api/simulations/cpu   → Start CPU stress simulation
 *   DELETE /api/simulations/cpu/:id → Stop CPU stress simulation
 *   POST   /api/simulations/memory → Allocate memory
 *   DELETE /api/simulations/memory/:id → Release memory
 *   POST   /api/simulations/eventloop → Block event loop
 *   GET    /api/simulations/slow  → Slow request (GET for browser testing)
 *   POST   /api/simulations/crash/* → Trigger crash simulations
 *   GET    /api/loadtest          → Load test endpoint
 *   GET    /api/simulations       → List all active simulations
 *   GET    /api/admin/status      → Admin status overview
 *   GET    /api/admin/events      → Event log entries
 *
 * PORTING NOTES:
 *   - Java Spring Boot: @SpringBootApplication with @RestController classes.
 *   - Python Flask/FastAPI: app = Flask() or FastAPI() with route decorators.
 *   - PHP Laravel: routes/api.php with Controller classes.
 *   - C# ASP.NET: Startup.cs or Program.cs with MapControllers/MapGet.
 *   The pattern is the same: define middleware pipeline, mount route handlers,
 *   add error handling as the last middleware.
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
import { loadtestRouter } from './controllers/loadtest.controller';

/**
 * Creates and configures the Express application.
 *
 * This factory function pattern allows creating fresh app instances for testing.
 * The app is framework-agnostic in design: middleware pipeline → route handlers → error handler.
 *
 * @returns Configured Express application instance (without HTTP server — that's in index.ts)
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
  app.use('/api/loadtest', loadtestRouter);
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
