/**
 * Slow Request Service
 *
 * Simulates slow HTTP responses using artificial delays.
 *
 * @module services/slow-request
 */

import { Simulation, SlowRequestParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';
import { delay } from '../utils';

/**
 * Slow Request Service
 *
 * Uses setTimeout to create artificial delays in HTTP responses.
 */
class SlowRequestServiceClass {
  /**
   * Delays the response for the specified duration.
   *
   * @param params - Slow request parameters
   * @returns The completed simulation
   */
  async delay(params: SlowRequestParams): Promise<Simulation> {
    const { delaySeconds } = params;

    // Create simulation record
    const simulation = SimulationTrackerService.createSimulation(
      'SLOW_REQUEST',
      { type: 'SLOW_REQUEST', delaySeconds },
      delaySeconds
    );

    // Log the start
    EventLogService.info('SIMULATION_STARTED', `Slow request started: ${delaySeconds}s delay`, {
      simulationId: simulation.id,
      simulationType: 'SLOW_REQUEST',
      details: { delaySeconds },
    });

    try {
      // Wait for the specified duration
      await delay(delaySeconds * 1000);

      // Mark as completed
      SimulationTrackerService.completeSimulation(simulation.id);

      EventLogService.info('SIMULATION_COMPLETED', 'Slow request completed', {
        simulationId: simulation.id,
        simulationType: 'SLOW_REQUEST',
      });

      return SimulationTrackerService.getSimulation(simulation.id) ?? simulation;
    } catch (error) {
      SimulationTrackerService.failSimulation(simulation.id);
      EventLogService.error(
        'SIMULATION_FAILED',
        `Slow request failed: ${(error as Error).message}`,
        {
          simulationId: simulation.id,
          simulationType: 'SLOW_REQUEST',
        }
      );
      throw error;
    }
  }
}

/**
 * Singleton instance of the SlowRequestService.
 */
export const SlowRequestService = new SlowRequestServiceClass();
