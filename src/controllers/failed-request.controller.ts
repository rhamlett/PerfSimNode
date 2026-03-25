/**
 * =============================================================================
 * FAILED REQUEST CONTROLLER — HTTP 5xx Error Generation REST API
 * =============================================================================
 *
 * PURPOSE:
 *   REST endpoint for generating HTTP 5xx server errors for testing error
 *   monitoring and alerting in Azure AppLens and Application Insights.
 *
 * ENDPOINTS:
 *   POST /api/simulations/failed
 *     - requestCount: Number of failed requests to generate (default: 5)
 *
 * BEHAVIOR:
 *   Each request internally calls the load test endpoint with 100% error
 *   probability. The requests do real work (CPU, memory, delay) before
 *   failing, making them visible in latency monitoring and producing
 *   genuine 500 responses in server logs.
 *
 * @module controllers/failed-request
 */

import { Router, Request, Response, NextFunction } from 'express';
import { FailedRequestService } from '../services/failed-request.service';
import { validateOptionalInteger } from '../middleware/validation';

/**
 * Express router for failed request simulation endpoints.
 */
export const failedRouter = Router();

/**
 * POST /api/simulations/failed
 *
 * Generates HTTP 5xx errors by making internal requests to the load test
 * endpoint with 100% error injection enabled.
 *
 * @route POST /api/simulations/failed
 * @body {number} requestCount - Number of failed requests to generate (default: 5, max: 50)
 * @returns {FailedRequestResponse} Summary of generated errors
 */
failedRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input parameters (no upper limit)
    const requestCount = validateOptionalInteger(
      req.body.requestCount,
      'requestCount',
      1,        // min
      Infinity, // no max limit
      5         // default
    );

    // Generate the failed requests
    const simulation = await FailedRequestService.generateFailedRequests({ requestCount });

    res.json({
      id: simulation.id,
      type: simulation.type,
      message: `Generated ${requestCount} HTTP 5xx errors`,
      status: simulation.status,
      requestCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
