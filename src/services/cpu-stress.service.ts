/**
 * CPU Stress Service
 *
 * Simulates CPU stress using child processes for guaranteed multi-core utilization.
 * Uses child_process.fork() which spawns real OS processes on separate cores.
 *
 * @module services/cpu-stress
 */

import { fork, ChildProcess } from 'child_process';
import { cpus } from 'os';
import path from 'path';
import { Simulation, CpuStressParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';

/** Active CPU stress processes by simulation ID */
const activeProcesses: Map<string, ChildProcess[]> = new Map();
const activeTimeouts: Map<string, NodeJS.Timeout> = new Map();

/**
 * CPU Stress Service
 *
 * Uses child_process.fork() to spawn separate OS processes.
 * Each process runs on its own CPU core, guaranteed by the OS scheduler.
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

    // Start the CPU burn processes
    this.startCpuProcesses(simulation.id, targetLoadPercent, durationSeconds);

    return simulation;
  }

  /**
   * Stops a running CPU stress simulation.
   *
   * @param id - Simulation ID
   * @returns The stopped simulation or undefined if not found
   */
  stop(id: string): Simulation | undefined {
    // Stop the CPU processes
    this.stopCpuProcesses(id);

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
   * Starts CPU worker processes for a simulation.
   *
   * Uses child_process.fork() to spawn separate OS processes.
   * Each process burns 100% of one CPU core.
   *
   * @param simulationId - Simulation ID
   * @param targetLoadPercent - Target CPU load percentage (1-100)
   * @param durationSeconds - Total duration in seconds
   */
  private startCpuProcesses(
    simulationId: string,
    targetLoadPercent: number,
    durationSeconds: number
  ): void {
    const numCpus = cpus().length;
    
    // Calculate workers: for 100% on 2 CPUs = 2 processes
    // For 50% on 2 CPUs = 1 process
    const numProcesses = Math.max(1, Math.round((targetLoadPercent / 100) * numCpus));

    const processes: ChildProcess[] = [];
    const workerPath = path.join(__dirname, 'cpu-worker.js');
    let processesReady = 0;
    let processErrors: string[] = [];

    for (let i = 0; i < numProcesses; i++) {
      try {
        const child = fork(workerPath, [], {
          detached: false,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });

        child.on('message', (msg) => {
          if (msg === 'ready') {
            processesReady++;
          }
        });

        child.on('error', (err) => {
          processErrors.push(`Process ${i}: ${err.message}`);
        });

        child.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            processErrors.push(`Process ${i} exited with code ${code}`);
          }
        });

        processes.push(child);
      } catch (err) {
        processErrors.push(`Failed to spawn process ${i}: ${err}`);
      }
    }

    activeProcesses.set(simulationId, processes);

    // Log status after brief delay
    setTimeout(() => {
      const status = processErrors.length > 0 
        ? `ERRORS: ${processErrors.join('; ')}`
        : `ready=${processesReady}`;
      process.stdout.write(`[CPU Stress] fork() - target=${targetLoadPercent}%, cpus=${numCpus}, processes=${processes.length}, ${status}\n`);
    }, 1000);

    // Set up auto-completion timeout
    const timeout = setTimeout(() => {
      this.stopCpuProcesses(simulationId);
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
   * Stops CPU worker processes for a simulation.
   *
   * @param simulationId - Simulation ID
   */
  private stopCpuProcesses(simulationId: string): void {
    // Clear the timeout
    const timeout = activeTimeouts.get(simulationId);
    if (timeout) {
      clearTimeout(timeout);
      activeTimeouts.delete(simulationId);
    }

    // Terminate all processes
    const processes = activeProcesses.get(simulationId);
    if (processes) {
      for (const child of processes) {
        try {
          // Send stop message
          if (child.connected) {
            child.send('stop');
          }
          // Force kill after 200ms if still running
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 200);
        } catch {
          // Process may already be terminated
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore
          }
        }
      }
      activeProcesses.delete(simulationId);
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
