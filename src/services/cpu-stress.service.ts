/**
 * CPU Stress Service
 *
 * Simulates CPU stress using crypto operations.
 *
 * @module services/cpu-stress
 */

import { pbkdf2Sync } from 'crypto';
import { Simulation, CpuStressParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';

/** Active CPU stress interval timers by simulation ID */
const activeIntervals: Map<string, NodeJS.Timeout> = new Map();

/**
 * CPU Stress Service
 *
 * Uses crypto.pbkdf2Sync to generate CPU load in controlled bursts.
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

    // Start the CPU burn loop
    this.startCpuBurn(simulation.id, targetLoadPercent, durationSeconds);

    return simulation;
  }

  /**
   * Stops a running CPU stress simulation.
   *
   * @param id - Simulation ID
   * @returns The stopped simulation or undefined if not found
   */
  stop(id: string): Simulation | undefined {
    // Stop the CPU burn interval
    this.stopCpuBurn(id);

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
   * Starts the CPU burn loop for a simulation.
   *
   * The loop runs based on target load percentage:
   * - Burn CPU for (targetLoad / 100) * interval
   * - Sleep for remaining interval time
   *
   * @param simulationId - Simulation ID
   * @param targetLoadPercent - Target CPU load percentage (1-100)
   * @param durationSeconds - Total duration in seconds
   */
  private startCpuBurn(
    simulationId: string,
    targetLoadPercent: number,
    durationSeconds: number
  ): void {
    const intervalMs = 100; // Run every 100ms
    const burnTimeMs = (targetLoadPercent / 100) * intervalMs;
    const endTime = Date.now() + durationSeconds * 1000;

    const interval = setInterval(() => {
      // Check if simulation should end
      if (Date.now() >= endTime) {
        this.stopCpuBurn(simulationId);
        const simulation = SimulationTrackerService.completeSimulation(simulationId);
        if (simulation) {
          EventLogService.info('SIMULATION_COMPLETED', 'CPU stress simulation completed', {
            simulationId,
            simulationType: 'CPU_STRESS',
          });
        }
        return;
      }

      // Check if simulation still exists and is active
      const simulation = SimulationTrackerService.getSimulation(simulationId);
      if (!simulation || simulation.status !== 'ACTIVE') {
        this.stopCpuBurn(simulationId);
        return;
      }

      // Burn CPU for the calculated time
      this.cpuBurn(burnTimeMs);
    }, intervalMs);

    activeIntervals.set(simulationId, interval);
  }

  /**
   * Stops the CPU burn loop for a simulation.
   *
   * @param simulationId - Simulation ID
   */
  private stopCpuBurn(simulationId: string): void {
    const interval = activeIntervals.get(simulationId);
    if (interval) {
      clearInterval(interval);
      activeIntervals.delete(simulationId);
    }
  }

  /**
   * Performs CPU-intensive work for approximately the specified duration.
   *
   * Uses PBKDF2 with calibrated iterations to consume CPU.
   *
   * @param durationMs - Duration to burn CPU in milliseconds
   */
  private cpuBurn(durationMs: number): void {
    const endTime = Date.now() + durationMs;
    while (Date.now() < endTime) {
      // Each call consumes ~1-2ms of CPU time
      pbkdf2Sync('password', 'salt', 1000, 64, 'sha512');
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
