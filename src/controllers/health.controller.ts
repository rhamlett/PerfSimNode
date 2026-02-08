/**
 * Health Controller
 *
 * Provides health check endpoint for monitoring and Azure App Service.
 *
 * @module controllers/health
 */

import { Router, Request, Response } from 'express';
import { APP_VERSION } from '../config';
import { HealthResponse } from '../types';

/**
 * Express router for health endpoints.
 */
export const healthRouter = Router();

/**
 * GET /api/health
 *
 * Returns service status and basic metrics.
 *
 * @route GET /api/health
 * @returns {HealthResponse} Service health status
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  const response: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime() * 100) / 100,
    version: APP_VERSION,
  };

  res.json(response);
});
