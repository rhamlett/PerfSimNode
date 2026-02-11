/**
 * Slow Request Service
 *
 * Simulates slow HTTP responses using various blocking patterns:
 * - setTimeout: Non-blocking delay (server remains responsive)
 * - libuv: Saturates libuv thread pool (affects fs/dns operations)
 * - worker: Spawns blocking worker threads (similar to .NET ThreadPool)
 *
 * @module services/slow-request
 */

import { Worker } from 'worker_threads';
import { pbkdf2Sync } from 'crypto';
import path from 'path';
import { Simulation, SlowRequestParams, SlowRequestBlockingPattern } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';
import { delay } from '../utils';

// Default libuv thread pool size is 4
const LIBUV_THREAD_POOL_SIZE = parseInt(process.env.UV_THREADPOOL_SIZE || '4', 10);

/**
 * Slow Request Service
 *
 * Provides multiple blocking patterns for simulating slow requests.
 */
class SlowRequestServiceClass {
  /**
   * Delays the response using the specified blocking pattern.
   *
   * @param params - Slow request parameters including blocking pattern
   * @returns The completed simulation
   */
  async delay(params: SlowRequestParams): Promise<Simulation> {
    const { delaySeconds, blockingPattern = 'setTimeout' } = params;

    // Create simulation record
    const simulation = SimulationTrackerService.createSimulation(
      'SLOW_REQUEST',
      { type: 'SLOW_REQUEST', delaySeconds, blockingPattern },
      delaySeconds
    );

    // Log the start with pattern info
    const patternDesc = this.getPatternDescription(blockingPattern);
    EventLogService.info('SIMULATION_STARTED', `Slow request started: ${delaySeconds}s delay (${patternDesc})`, {
      simulationId: simulation.id,
      simulationType: 'SLOW_REQUEST',
      details: { delaySeconds, blockingPattern },
    });

    try {
      // Execute the appropriate blocking pattern
      switch (blockingPattern) {
        case 'libuv':
          await this.blockLibuv(delaySeconds * 1000);
          break;
        case 'worker':
          await this.blockWorker(delaySeconds * 1000);
          break;
        case 'setTimeout':
        default:
          await delay(delaySeconds * 1000);
          break;
      }

      // Mark as completed
      SimulationTrackerService.completeSimulation(simulation.id);

      EventLogService.info('SIMULATION_COMPLETED', `Slow request completed (${patternDesc})`, {
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

  /**
   * Blocks using libuv thread pool saturation.
   * Uses synchronous crypto operations that run on the libuv thread pool.
   * When all 4 threads are busy, other fs/dns/crypto operations queue up.
   *
   * @param durationMs - How long to block in milliseconds
   */
  private async blockLibuv(durationMs: number): Promise<void> {
    const endTime = Date.now() + durationMs;
    
    // Create promises that will saturate the libuv thread pool
    // Each pbkdf2 call blocks a libuv thread for ~10-20ms
    const saturateThread = async (): Promise<void> => {
      while (Date.now() < endTime) {
        // Sync crypto blocks a libuv thread
        // We use a reasonable iteration count that takes ~10-20ms
        await new Promise<void>((resolve) => {
          setImmediate(() => {
            pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
            resolve();
          });
        });
      }
    };

    // Saturate all libuv threads (default: 4)
    const workers = Array(LIBUV_THREAD_POOL_SIZE).fill(null).map(() => saturateThread());
    await Promise.all(workers);
  }

  /**
   * Blocks using Worker Threads.
   * Similar to .NET ThreadPool - spawns actual threads that block.
   *
   * @param durationMs - How long to block in milliseconds
   */
  private async blockWorker(durationMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Path to the compiled worker (in dist/)
      const workerPath = path.join(__dirname, 'slow-request-worker.js');
      
      const worker = new Worker(workerPath, {
        workerData: { durationMs },
      });

      worker.on('message', (msg) => {
        if (msg.status === 'completed') {
          worker.terminate();
          resolve();
        }
      });

      worker.on('error', (error) => {
        worker.terminate();
        reject(error);
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Gets a human-readable description of the blocking pattern.
   */
  private getPatternDescription(pattern: SlowRequestBlockingPattern): string {
    switch (pattern) {
      case 'libuv':
        return 'libuv thread pool saturation';
      case 'worker':
        return 'worker thread blocking';
      case 'setTimeout':
      default:
        return 'non-blocking setTimeout';
    }
  }
}

/**
 * Singleton instance of the SlowRequestService.
 */
export const SlowRequestService = new SlowRequestServiceClass();
