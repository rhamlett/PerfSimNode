/**
 * =============================================================================
 * FAILED REQUEST SERVICE — HTTP 5xx Error Generation
 * =============================================================================
 *
 * PURPOSE:
 *   Generates HTTP 5xx server errors by making internal requests to the load
 *   test endpoint with 100% error injection enabled. Each request does real
 *   work (CPU, memory, delay) before failing, ensuring the errors appear in
 *   monitoring tools like Azure AppLens as genuine server failures.
 *
 * ALGORITHM:
 *   1. User specifies number of failed requests to generate
 *   2. Service makes HTTP requests to GET /api/loadtest with parameters:
 *      - errorAboveConcurrent=0 (always trigger error check)
 *      - errorPercent=100 (100% probability of error)
 *      - workIterations=700, bufferSizeKb=5000, baselineDelayMs=500
 *        (enough work to be visible in latency monitoring)
 *   3. Each request fails with a random exception type from the load test
 *      service's exception pool (17 different error types)
 *   4. Errors produce HTTP 500 responses and appear in AppLens/App Insights
 *
 * ERROR DIVERSITY:
 *   The load test service randomly selects from exceptions including:
 *   - InvalidOperationError, TypeError, ReferenceError, TimeoutError
 *   - IOException, HttpRequestError, OutOfMemoryError, StackOverflowError
 *   This produces diverse error signatures for training diagnostics skills.
 *
 * PORTING NOTES:
 *   - This service acts as an HTTP client making requests to itself
 *   - In Java: Use HttpClient to call the load test endpoint
 *   - In Python: Use requests or aiohttp to call the endpoint
 *   - The key is leveraging existing error injection infrastructure
 *
 * @module services/failed-request
 */

import http from 'http';
import { Simulation, FailedRequestParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';
import { SimulationContextService } from './simulation-context.service';
import { config } from '../config';

/**
 * Parameters for load test request configured for guaranteed failure
 */
const FAILURE_PARAMS = {
  workIterations: 700,      // CPU work per cycle (visible in metrics)
  bufferSizeKb: 5000,       // 5MB memory per request (visible in RSS)
  baselineDelayMs: 500,     // 500ms baseline delay (visible in latency chart)
  softLimit: 100,           // High soft limit (no degradation delay)
  degradationFactor: 0,     // No additional delay
  errorAboveConcurrent: -1, // Always inject errors (special value)
  errorPercent: 100,        // 100% chance of error
};

/**
 * Result of a single failed request attempt
 */
interface FailedRequestResult {
  success: boolean;
  statusCode: number;
  errorType: string | null;
  errorMessage: string | null;
  latencyMs: number;
}

/**
 * Failed Request Service
 *
 * Generates HTTP 5xx errors for testing error monitoring and alerting.
 */
class FailedRequestServiceClass {
  /**
   * Generates the specified number of failed requests.
   *
   * @param params - Request parameters including count
   * @returns The simulation record
   */
  async generateFailedRequests(params: FailedRequestParams): Promise<Simulation> {
    const { requestCount } = params;

    // Create simulation record
    const simulation = SimulationTrackerService.createSimulation(
      'FAILED_REQUEST',
      { type: 'FAILED_REQUEST', requestCount },
      60 // Max 60 seconds for the batch
    );

    // Set Application Insights correlation context
    SimulationContextService.setContext(simulation.id, 'FAILED_REQUEST');

    // Log the start
    EventLogService.info('SIMULATION_STARTED', `Failed request simulation started: generating ${requestCount} HTTP 5xx errors`, {
      simulationId: simulation.id,
      simulationType: 'FAILED_REQUEST',
      details: { requestCount },
    });

    // Track results
    let successfulFailures = 0;
    const errors: string[] = [];

    // Fire all requests concurrently for maximum visibility
    const promises: Promise<FailedRequestResult>[] = [];
    for (let i = 0; i < requestCount; i++) {
      promises.push(this.makeFailingRequest());
    }

    // Wait for all requests to complete
    const results = await Promise.all(promises);

    // Process results and log each error
    for (const result of results) {
      if (result.statusCode >= 500) {
        successfulFailures++;
        const errorType = result.errorType || 'Unknown Error';
        errors.push(errorType);
        
        // Log each failed request with its error type
        EventLogService.error('FAILED_REQUEST_ERROR', `HTTP 500 generated: ${errorType} - ${result.errorMessage || 'No message'}`, {
          simulationId: simulation.id,
          simulationType: 'FAILED_REQUEST',
          details: {
            statusCode: result.statusCode,
            errorType,
            latencyMs: result.latencyMs,
          },
        });
      }
    }

    // Complete the simulation
    SimulationTrackerService.completeSimulation(simulation.id);

    // Log completion summary
    EventLogService.info('SIMULATION_COMPLETED', `Failed request simulation completed: ${successfulFailures}/${requestCount} HTTP 5xx errors generated`, {
      simulationId: simulation.id,
      simulationType: 'FAILED_REQUEST',
      details: {
        requestCount,
        successfulFailures,
        uniqueErrorTypes: [...new Set(errors)].length,
      },
    });

    return simulation;
  }

  /**
   * Makes a single request to the load test endpoint configured to fail.
   *
   * Uses Node.js http module to make a local request to avoid external dependencies.
   * The load test endpoint is configured with errorPercent=100 to guarantee failure.
   */
  private makeFailingRequest(): Promise<FailedRequestResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Build query string with failure parameters
      const queryParams = new URLSearchParams({
        workIterations: String(FAILURE_PARAMS.workIterations),
        bufferSizeKb: String(FAILURE_PARAMS.bufferSizeKb),
        baselineDelayMs: String(FAILURE_PARAMS.baselineDelayMs),
        softLimit: String(FAILURE_PARAMS.softLimit),
        degradationFactor: String(FAILURE_PARAMS.degradationFactor),
        errorAboveConcurrent: String(FAILURE_PARAMS.errorAboveConcurrent),
        errorPercent: String(FAILURE_PARAMS.errorPercent),
        suppressLogs: 'true', // Suppress load test logs - failed request service handles its own logging
      });

      const options: http.RequestOptions = {
        hostname: 'localhost',
        port: config.port,
        path: `/api/loadtest?${queryParams.toString()}`,
        method: 'GET',
        timeout: 30000, // 30 second timeout
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          let errorType: string | null = null;
          let errorMessage: string | null = null;

          // Try to parse error details from response body
          try {
            const parsed = JSON.parse(body);
            if (parsed.error) {
              // Extract error type from the error message
              const match = parsed.error.match(/^([A-Za-z]+Error?):/);
              errorType = match ? match[1] : 'ServerError';
              errorMessage = parsed.error;
            }
          } catch {
            // If body isn't JSON, use generic error
            errorType = 'ServerError';
            errorMessage = body.slice(0, 200);
          }

          resolve({
            success: res.statusCode !== undefined && res.statusCode < 400,
            statusCode: res.statusCode || 500,
            errorType,
            errorMessage,
            latencyMs,
          });
        });
      });

      req.on('error', (err) => {
        const latencyMs = Date.now() - startTime;
        resolve({
          success: false,
          statusCode: 500,
          errorType: 'ConnectionError',
          errorMessage: err.message,
          latencyMs,
        });
      });

      req.on('timeout', () => {
        const latencyMs = Date.now() - startTime;
        req.destroy();
        resolve({
          success: false,
          statusCode: 504,
          errorType: 'TimeoutError',
          errorMessage: 'Request timed out',
          latencyMs,
        });
      });

      req.end();
    });
  }
}

/**
 * Singleton instance of the Failed Request Service.
 */
export const FailedRequestService = new FailedRequestServiceClass();
