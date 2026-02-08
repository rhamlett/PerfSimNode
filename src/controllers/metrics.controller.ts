/**
 * Metrics Controller
 *
 * Provides system metrics endpoint for observability.
 *
 * @module controllers/metrics
 */

import { Router, Request, Response } from 'express';
import { MetricsService } from '../services/metrics.service';

/**
 * Express router for metrics endpoints.
 */
export const metricsRouter = Router();

/**
 * GET /api/metrics
 *
 * Returns current system metrics snapshot.
 *
 * @route GET /api/metrics
 * @returns {SystemMetrics} Current system metrics
 */
metricsRouter.get('/', (_req: Request, res: Response) => {
  const metrics = MetricsService.getMetrics();

  // Convert Date to ISO string for JSON serialization
  res.json({
    ...metrics,
    timestamp: metrics.timestamp.toISOString(),
  });
});
