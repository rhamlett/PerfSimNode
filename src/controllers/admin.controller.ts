/**
 * Admin Controller
 *
 * Handles administrative endpoints for status, events, and simulations listing.
 *
 * @module controllers/admin
 */

import { Router, Request, Response } from 'express';
import { SimulationTrackerService } from '../services/simulation-tracker.service';
import { EventLogService } from '../services/event-log.service';
import { MetricsService } from '../services/metrics.service';
import { config, APP_VERSION } from '../config';
import { validateOptionalInteger } from '../middleware/validation';

/**
 * Express router for admin endpoints.
 */
export const adminRouter = Router();

/**
 * GET /api/simulations
 *
 * Lists all active simulations of any type.
 *
 * @route GET /api/simulations
 * @returns {Object} List of active simulations
 */
adminRouter.get('/simulations', (_req: Request, res: Response) => {
  const simulations = SimulationTrackerService.getActiveSimulations();

  res.json({
    simulations: simulations.map((sim) => ({
      id: sim.id,
      type: sim.type,
      status: sim.status,
      parameters: sim.parameters,
      startedAt: sim.startedAt.toISOString(),
      scheduledEndAt: sim.scheduledEndAt.toISOString(),
    })),
    count: simulations.length,
  });
});

/**
 * GET /api/admin/status
 *
 * Returns detailed admin status including configuration and simulations.
 *
 * @route GET /api/admin/status
 * @returns {AdminStatusResponse} Detailed admin status
 */
adminRouter.get('/admin/status', (_req: Request, res: Response) => {
  const simulations = SimulationTrackerService.getActiveSimulations();
  const metrics = MetricsService.getMetrics();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime() * 100) / 100,
    version: APP_VERSION,
    config: {
      port: config.port,
      metricsIntervalMs: config.metricsIntervalMs,
      maxSimulationDurationSeconds: config.maxSimulationDurationSeconds,
      maxMemoryAllocationMb: config.maxMemoryAllocationMb,
      eventLogMaxEntries: config.eventLogMaxEntries,
    },
    activeSimulations: simulations.map((sim) => ({
      id: sim.id,
      type: sim.type,
      status: sim.status,
      parameters: sim.parameters,
      startedAt: sim.startedAt.toISOString(),
      scheduledEndAt: sim.scheduledEndAt.toISOString(),
    })),
    simulationCount: simulations.length,
    metrics: {
      ...metrics,
      timestamp: metrics.timestamp.toISOString(),
    },
  });
});

/**
 * GET /api/admin/events
 *
 * Returns recent event log entries.
 *
 * @route GET /api/admin/events
 * @query {number} limit - Maximum number of events to return (default: 50, max: 100)
 * @returns {Object} Recent event log entries
 */
adminRouter.get('/admin/events', (req: Request, res: Response) => {
  const limit = validateOptionalInteger(req.query.limit, 'limit', 1, 100, 50);
  const events = EventLogService.getRecentEntries(limit);

  res.json({
    events: events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      level: event.level,
      event: event.event,
      message: event.message,
      simulationId: event.simulationId,
      simulationType: event.simulationType,
      details: event.details,
    })),
    count: events.length,
    total: EventLogService.getCount(),
  });
});
