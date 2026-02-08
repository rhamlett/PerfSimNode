/**
 * Event Loop Block Service
 *
 * Simulates event loop blocking using synchronous operations.
 *
 * @module services/eventloop-block
 */

import { pbkdf2Sync } from 'crypto';
import { Simulation, EventLoopBlockingParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';

/**
 * Event Loop Block Service
 *
 * Uses crypto.pbkdf2Sync to block the event loop for demonstration purposes.
 */
class EventLoopBlockServiceClass {
  /**
   * Blocks the event loop for the specified duration.
   *
   * WARNING: This will make the server completely unresponsive during execution.
   * The response is sent AFTER the blocking completes.
   *
   * @param params - Event loop blocking parameters
   * @returns The completed simulation
   */
  block(params: EventLoopBlockingParams): Simulation {
    const { durationSeconds } = params;

    // Create simulation record
    const simulation = SimulationTrackerService.createSimulation(
      'EVENT_LOOP_BLOCKING',
      { type: 'EVENT_LOOP_BLOCKING', durationSeconds },
      durationSeconds
    );

    // Log the start
    EventLogService.warn(
      'SIMULATION_STARTED',
      `Event loop blocking started for ${durationSeconds}s - server will be unresponsive`,
      {
        simulationId: simulation.id,
        simulationType: 'EVENT_LOOP_BLOCKING',
        details: { durationSeconds },
      }
    );

    try {
      // Block the event loop synchronously
      this.blockEventLoop(durationSeconds * 1000);

      // Mark as completed
      SimulationTrackerService.completeSimulation(simulation.id);

      EventLogService.info('SIMULATION_COMPLETED', 'Event loop blocking completed', {
        simulationId: simulation.id,
        simulationType: 'EVENT_LOOP_BLOCKING',
      });

      // Return the updated simulation
      return SimulationTrackerService.getSimulation(simulation.id) ?? simulation;
    } catch (error) {
      SimulationTrackerService.failSimulation(simulation.id);
      EventLogService.error(
        'SIMULATION_FAILED',
        `Event loop blocking failed: ${(error as Error).message}`,
        {
          simulationId: simulation.id,
          simulationType: 'EVENT_LOOP_BLOCKING',
        }
      );
      throw error;
    }
  }

  /**
   * Blocks the event loop for the specified duration.
   *
   * @param durationMs - Duration to block in milliseconds
   */
  private blockEventLoop(durationMs: number): void {
    const endTime = Date.now() + durationMs;
    while (Date.now() < endTime) {
      // Higher iteration count for longer blocking per call
      pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
    }
  }
}

/**
 * Singleton instance of the EventLoopBlockService.
 */
export const EventLoopBlockService = new EventLoopBlockServiceClass();
