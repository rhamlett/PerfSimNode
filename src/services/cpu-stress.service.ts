/**
 * CPU Stress Service
 *
 * Simulates CPU stress using worker threads for multi-core utilization.
 *
 * @module services/cpu-stress
 */

import { Worker } from 'worker_threads';
import { cpus } from 'os';
import path from 'path';
import { Simulation, CpuStressParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';

/** Active CPU stress workers by simulation ID */
const activeWorkers: Map<string, Worker[]> = new Map();
const activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

/**
 * CPU Stress Service
 *
 * Uses worker threads to generate CPU load across multiple cores.
 * Spawns workers proportional to available CPUs and target load.
 */
class CpuStressServiceClass {
  /**
   * Starts a CPU stress simulation.
   *
   * @param params - CPU stress parameters
   * @returns The created simulation
   */
  start(params: CpuStressParams): Simulation {
    const { targetLoadPercent, durationSeconds } = params;

    // Create simulation record
    const simulation = SimulationTrackerService.createSimulation(
      'CPU_STRESS',
      { type: 'CPU_STRESS', ...params },
      durationSeconds
    );

    // Log the start
    EventLogService.info('SIMULATION_STARTED', `CPU stress simulation started at ${targetLoadPercent}% for ${durationSeconds}s`, {
      simulationId: simulation.id,
      simulationType: 'CPU_STRESS',
      details: { targetLoadPercent, durationSeconds },
    });

    // Start the CPU burn workers
    this.startCpuWorkers(simulation.id, targetLoadPercent, durationSeconds);

    return simulation;
  }

  /**
   * Stops a running CPU stress simulation.
   *
   * @param id - Simulation ID
   * @returns The stopped simulation or undefined if not found
   */
  stop(id: string): Simulation | undefined {
    // Stop the CPU workers
    this.stopCpuWorkers(id);

    // Update simulation status
    const simulation = SimulationTrackerService.stopSimulation(id);

    if (simulation) {
      EventLogService.info('SIMULATION_STOPPED', 'CPU stress simulation stopped by user', {
        simulationId: id,
        simulationType: 'CPU_STRESS',
      });
    }

    return simulation;
  }

  /**
   * Starts CPU worker threads for a simulation.
   *
   * Spawns one worker per CPU core, each running at the target load percentage.
   *
   * @param simulationId - Simulation ID
   * @param targetLoadPercent - Target CPU load percentage (1-100)
   * @param durationSeconds - Total duration in seconds
   */
  private startCpuWorkers(
    simulationId: string,
    targetLoadPercent: number,
    durationSeconds: number
  ): void {
    const numCpus = cpus().length;
    
    // Spawn one worker per CPU core, each running at target percentage
    // This ensures even distribution across all cores
    const numWorkers = numCpus;
    const perWorkerLoad = targetLoadPercent;

    console.log(`[CPU Stress] Spawning ${numWorkers} workers at ${perWorkerLoad}% each (${numCpus} CPUs detected)`);

    const workers: Worker[] = [];
    const workerPath = path.join(__dirname, 'cpu-worker.js');

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = new Worker(workerPath, {
          workerData: {
            targetLoadPercent: perWorkerLoad,
          },
        });

        worker.on('error', (err) => {
          console.error(`[CPU Stress] Worker error: ${err.message}`);
        });

        worker.on('exit', (code) => {
          if (code !== 0) {
            console.log(`[CPU Stress] Worker exited with code ${code}`);
          }
        });

        workers.push(worker);
      } catch (err) {
        console.error(`[CPU Stress] Failed to spawn worker: ${err}`);
      }
    }

    activeWorkers.set(simulationId, workers);

    // Set up auto-completion timeout
    const timeout = setTimeout(() => {
      this.stopCpuWorkers(simulationId);
      const simulation = SimulationTrackerService.completeSimulation(simulationId);
      if (simulation) {
        EventLogService.info('SIMULATION_COMPLETED', 'CPU stress simulation completed', {
          simulationId,
          simulationType: 'CPU_STRESS',
        });
      }
    }, durationSeconds * 1000);

    activeTimeouts.set(simulationId, timeout);
  }

  /**
   * Stops CPU worker threads for a simulation.
   *
   * @param simulationId - Simulation ID
   */
  private stopCpuWorkers(simulationId: string): void {
    // Clear the timeout
    const timeout = activeTimeouts.get(simulationId);
    if (timeout) {
      clearTimeout(timeout);
      activeTimeouts.delete(simulationId);
    }

    // Terminate all workers
    const workers = activeWorkers.get(simulationId);
    if (workers) {
      for (const worker of workers) {
        try {
          worker.postMessage('stop');
          // Force terminate after 100ms if not stopped gracefully
          setTimeout(() => {
            worker.terminate().catch(() => {});
          }, 100);
        } catch {
          // Worker may already be terminated
        }
      }
      activeWorkers.delete(simulationId);
    }
  }

  /**
   * Gets all active CPU stress simulations.
   *
   * @returns Array of active CPU stress simulations
   */
  getActiveSimulations(): Simulation[] {
    return SimulationTrackerService.getActiveSimulationsByType('CPU_STRESS');
  }

  /**
   * Checks if there are any active CPU stress simulations.
   *
   * @returns True if there are active simulations
   */
  hasActiveSimulations(): boolean {
    return this.getActiveSimulations().length > 0;
  }

  /**
   * Stops all active CPU stress simulations.
   */
  stopAll(): void {
    const activeSimulations = this.getActiveSimulations();
    for (const simulation of activeSimulations) {
      this.stop(simulation.id);
    }
  }
}

/**
 * Singleton instance of the CpuStressService.
 */
export const CpuStressService = new CpuStressServiceClass();
