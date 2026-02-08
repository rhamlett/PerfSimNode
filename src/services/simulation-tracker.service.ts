/**
 * Simulation Tracker Service
 *
 * Manages active simulations and their lifecycle.
 *
 * @module services/simulation-tracker
 */

import { Simulation, SimulationType, SimulationStatus, SimulationParameters } from '../types';
import { generateId } from '../utils';
import { config } from '../config';

/**
 * Service for tracking active simulations.
 *
 * Maintains the registry of all active simulations and handles lifecycle transitions.
 */
class SimulationTrackerServiceClass {
  private simulations: Map<string, Simulation> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Creates and registers a new simulation.
   *
   * @param type - Type of simulation
   * @param parameters - Simulation parameters
   * @param durationSeconds - Duration in seconds (optional, defaults to max)
   * @returns The created simulation
   */
  createSimulation(
    type: SimulationType,
    parameters: SimulationParameters,
    durationSeconds?: number
  ): Simulation {
    const id = generateId();
    const now = new Date();
    const duration = durationSeconds ?? config.maxSimulationDurationSeconds;
    const scheduledEndAt = new Date(now.getTime() + duration * 1000);

    const simulation: Simulation = {
      id,
      type,
      parameters,
      status: 'ACTIVE',
      startedAt: now,
      stoppedAt: null,
      scheduledEndAt,
    };

    this.simulations.set(id, simulation);

    // Set up auto-cleanup timer
    const timer = setTimeout(() => {
      this.completeSimulation(id);
    }, duration * 1000);

    this.cleanupTimers.set(id, timer);

    return simulation;
  }

  /**
   * Gets a simulation by ID.
   *
   * @param id - Simulation ID
   * @returns Simulation or undefined if not found
   */
  getSimulation(id: string): Simulation | undefined {
    return this.simulations.get(id);
  }

  /**
   * Gets all simulations.
   *
   * @returns Array of all simulations
   */
  getAllSimulations(): Simulation[] {
    return Array.from(this.simulations.values());
  }

  /**
   * Gets all active simulations.
   *
   * @returns Array of active simulations
   */
  getActiveSimulations(): Simulation[] {
    return this.getAllSimulations().filter((sim) => sim.status === 'ACTIVE');
  }

  /**
   * Gets active simulations of a specific type.
   *
   * @param type - Simulation type to filter by
   * @returns Array of active simulations of the specified type
   */
  getActiveSimulationsByType(type: SimulationType): Simulation[] {
    return this.getActiveSimulations().filter((sim) => sim.type === type);
  }

  /**
   * Stops a simulation (user-initiated).
   *
   * @param id - Simulation ID
   * @returns The stopped simulation or undefined if not found
   */
  stopSimulation(id: string): Simulation | undefined {
    return this.updateSimulationStatus(id, 'STOPPED');
  }

  /**
   * Marks a simulation as completed (duration elapsed).
   *
   * @param id - Simulation ID
   * @returns The completed simulation or undefined if not found
   */
  completeSimulation(id: string): Simulation | undefined {
    return this.updateSimulationStatus(id, 'COMPLETED');
  }

  /**
   * Marks a simulation as failed (error occurred).
   *
   * @param id - Simulation ID
   * @returns The failed simulation or undefined if not found
   */
  failSimulation(id: string): Simulation | undefined {
    return this.updateSimulationStatus(id, 'FAILED');
  }

  /**
   * Updates a simulation's status.
   *
   * @param id - Simulation ID
   * @param status - New status
   * @returns The updated simulation or undefined if not found
   */
  private updateSimulationStatus(id: string, status: SimulationStatus): Simulation | undefined {
    const simulation = this.simulations.get(id);
    if (!simulation || simulation.status !== 'ACTIVE') {
      return undefined;
    }

    simulation.status = status;
    simulation.stoppedAt = new Date();

    // Clear the cleanup timer
    const timer = this.cleanupTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(id);
    }

    return simulation;
  }

  /**
   * Removes a simulation from tracking.
   *
   * @param id - Simulation ID
   * @returns True if simulation was removed
   */
  removeSimulation(id: string): boolean {
    const timer = this.cleanupTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(id);
    }

    return this.simulations.delete(id);
  }

  /**
   * Gets the count of active simulations.
   *
   * @returns Number of active simulations
   */
  getActiveCount(): number {
    return this.getActiveSimulations().length;
  }

  /**
   * Clears all simulations and timers.
   *
   * Useful for testing and cleanup.
   */
  clear(): void {
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.simulations.clear();
  }
}

/**
 * Singleton instance of the SimulationTrackerService.
 */
export const SimulationTrackerService = new SimulationTrackerServiceClass();
