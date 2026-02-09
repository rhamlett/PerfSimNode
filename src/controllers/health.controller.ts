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

/**
 * GET /api/health/environment
 *
 * Returns Azure environment information or "Local" if not in Azure.
 *
 * @route GET /api/health/environment
 * @returns {Object} Environment info including SKU
 */
healthRouter.get('/environment', (_req: Request, res: Response) => {
  // Azure App Service sets WEBSITE_SKU for the worker size
  // Common values: Free, Shared, Basic, Standard, Premium, PremiumV2, PremiumV3
  const websiteSku = process.env.WEBSITE_SKU;
  const websiteSiteName = process.env.WEBSITE_SITE_NAME;
  const websiteInstanceId = process.env.WEBSITE_INSTANCE_ID;
  
  const isAzure = !!(websiteSiteName || websiteInstanceId);
  
  res.json({
    isAzure,
    sku: websiteSku || (isAzure ? 'Unknown' : 'Local'),
    siteName: websiteSiteName || null,
    instanceId: websiteInstanceId ? websiteInstanceId.slice(0, 8) : null,
  });
});

// Store build timestamp when server starts
const BUILD_TIMESTAMP = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

/**
 * GET /api/health/build
 *
 * Returns build information.
 *
 * @route GET /api/health/build
 * @returns {Object} Build info including timestamp
 */
healthRouter.get('/build', (_req: Request, res: Response) => {
  res.json({
    version: APP_VERSION,
    buildTime: BUILD_TIMESTAMP,
  });
});

/**
 * GET /api/health/probe
 *
 * Ultra-lightweight endpoint for heartbeat detection.
 * Used by client to detect event loop blocking.
 *
 * @route GET /api/health/probe
 * @returns {Object} Minimal response with server timestamp
 */
healthRouter.get('/probe', (_req: Request, res: Response) => {
  res.json({ ts: Date.now() });
});
