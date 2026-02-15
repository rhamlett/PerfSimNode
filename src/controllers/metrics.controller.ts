/**
 * =============================================================================
 * METRICS CONTROLLER — System Metrics & Probe Endpoints
 * =============================================================================
 *
 * PURPOSE:
 *   Exposes system metrics via REST for on-demand queries and provides a
 *   lightweight probe endpoint for latency monitoring.
 *
 * ENDPOINTS:
 *   GET /api/metrics       → Full system metrics snapshot (CPU, memory, event loop)
 *   GET /api/metrics/probe → Lightweight probe for sidecar latency measurement.
 *                            Also returns load test activity status so the
 *                            sidecar can adjust its behavior during load tests.
 *
 * NOTE: Real-time metrics are primarily delivered via WebSocket (see index.ts).
 *       These REST endpoints are for on-demand queries and sidecar probing.
 *
 * @module controllers/metrics
 */

import { Router, Request, Response } from 'express';
import { MetricsService } from '../services/metrics.service';
import { LoadTestService } from '../services/load-test.service';

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

/**
 * GET /api/metrics/probe
 *
 * Lightweight probe endpoint for latency monitoring.
 * Returns minimal data but registered as real API traffic (not filtered like /health).
 *
 * @route GET /api/metrics/probe
 * @returns {Object} Server timestamp for latency calculation
 */
metricsRouter.get('/probe', (_req: Request, res: Response) => {
  const stats = LoadTestService.getCurrentStats();
  res.json({
    ts: Date.now(),
    loadTest: {
      active: stats.currentConcurrentRequests > 0,
      concurrent: stats.currentConcurrentRequests,
    },
  });
});
