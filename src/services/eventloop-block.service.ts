/**
 * Event Loop Block Service
 *
 * Simulates event loop blocking using repeated synchronous chunks with brief
 * yields between them. This mirrors real-world sync-over-async patterns where
 * blocking operations (e.g. readFileSync in a loop) repeatedly seize the event
 * loop. The brief yields between chunks let queued I/O flush — probe responses,
 * IPC messages, Socket.IO emits — so the latency chart updates in real-time.
 *
 * @module services/eventloop-block
 */

import { pbkdf2Sync } from 'crypto';
import { Simulation, EventLoopBlockingParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';

/** Default chunk duration — long enough to spike latency, short enough to let probes through */
const DEFAULT_CHUNK_MS = 200;

/**
 * Event Loop Block Service
 *
 * Uses crypto.pbkdf2Sync in repeated chunks to block the event loop.
 * Between chunks a brief setImmediate yield allows queued I/O to flush.
 */
class EventLoopBlockServiceClass {
  /**
   * Blocks the event loop in chunks for the specified total duration.
   *
   * Each chunk runs pbkdf2Sync for `chunkMs` milliseconds, then yields via
   * setImmediate so queued network I/O (sidecar probe responses, IPC relay,
   * Socket.IO emits) can flush. The event loop is blocked ~97% of the time
   * — effectively unresponsive, but the dashboard can display latency spikes
   * in real-time instead of only after the simulation ends.
   *
   * @param params - Event loop blocking parameters
   * @returns The completed simulation
   */
  async block(params: EventLoopBlockingParams): Promise<Simulation> {
    const { durationSeconds, chunkMs = DEFAULT_CHUNK_MS } = params;

    // Create simulation record
    const simulation = SimulationTrackerService.createSimulation(
      'EVENT_LOOP_BLOCKING',
      { type: 'EVENT_LOOP_BLOCKING', durationSeconds, chunkMs },
      durationSeconds
    );

    // Log the start
    EventLogService.warn(
      'SIMULATION_STARTED',
      `Event loop blocking started for ${durationSeconds}s (${chunkMs}ms chunks) - server will be mostly unresponsive`,
      {
        simulationId: simulation.id,
        simulationType: 'EVENT_LOOP_BLOCKING',
        details: { durationSeconds, chunkMs },
      }
    );

    try {
      // Block the event loop in chunks with brief yields
      await this.blockEventLoopChunked(durationSeconds * 1000, chunkMs);

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
   * Blocks the event loop in repeated chunks, yielding briefly between each.
   *
   * @param totalDurationMs - Total blocking duration in milliseconds
   * @param chunkMs - Duration of each blocking chunk in milliseconds
   */
  private blockEventLoopChunked(totalDurationMs: number, chunkMs: number): Promise<void> {
    return new Promise((resolve) => {
      const endTime = Date.now() + totalDurationMs;

      const runChunk = (): void => {
        const chunkEnd = Math.min(Date.now() + chunkMs, endTime);
        // Block synchronously for one chunk
        while (Date.now() < chunkEnd) {
          pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
        }

        if (Date.now() < endTime) {
          // Yield briefly to let queued I/O flush, then block again
          setImmediate(runChunk);
        } else {
          resolve();
        }
      };

      runChunk();
    });
  }
}

/**
 * Singleton instance of the EventLoopBlockService.
 */
export const EventLoopBlockService = new EventLoopBlockServiceClass();
