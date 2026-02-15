/**
 * =============================================================================
 * CPU STRESS SERVICE — Multi-Core CPU Load Simulation
 * =============================================================================
 *
 * PURPOSE:
 *   Generates real CPU load by spawning separate OS processes that run tight
 *   synchronous loops. This makes CPU usage visible in system monitoring tools
 *   like Azure App Service metrics, top/htop, and Windows Task Manager.
 *
 * HOW IT WORKS:
 *   1. Calculate number of worker processes: round((targetLoadPercent/100) * CPU_CORES)
 *   2. Fork N child processes (cpu-worker.ts) via child_process.fork()
 *   3. Each child runs pbkdf2Sync in a tight loop, burning 100% of one CPU core
 *   4. After durationSeconds, kill all child processes
 *
 * WHY CHILD PROCESSES (NOT WORKER THREADS OR MAIN THREAD):
 *   - Node.js is single-threaded — CPU work in the main thread blocks ALL I/O
 *   - Worker Threads share the same process — CPU usage appears as one process
 *   - child_process.fork() creates separate OS processes that the OS scheduler
 *     distributes across physical CPU cores, producing real multi-core load
 *   - System-wide CPU metrics (os.cpus()) capture child process activity
 *
 * PORTING NOTES:
 *   - Java: Use ExecutorService.submit() with Runnable tasks in a fixed-size
 *     thread pool. Java threads map to OS threads and get scheduled on separate cores.
 *   - Python: Use multiprocessing.Process (NOT threading — GIL prevents parallelism).
 *     Each process runs a tight loop (e.g., while True: hashlib.pbkdf2_hmac(...))
 *   - C#: Use Task.Run() or Thread.Start() with synchronous CPU-bound work.
 *     .NET threads are OS threads and distribute across cores naturally.
 *   - PHP: Use pcntl_fork() for true multi-process CPU burning.
 *
 *   The key requirement: use OS-level parallelism (processes or native threads)
 *   to produce CPU load visible in SYSTEM-WIDE metrics, not just the main process.
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
 * PROCESS MANAGEMENT:
 * - activeProcesses: Map of simulation ID → array of ChildProcess handles
 * - activeTimeouts:  Map of simulation ID → auto-completion timer
 *
 * On start: fork N processes, store handles, set completion timer
 * On stop:  send 'stop' IPC message, force-kill after 200ms, clear timer
 * On complete: same as stop but triggered by timer expiration
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
   * ALGORITHM:
   * 1. Get CPU core count from os.cpus().length
   * 2. Calculate worker count: round((targetLoadPercent / 100) * numCpus)
   *    - 100% on 2 CPUs = 2 workers; 50% on 4 CPUs = 2 workers
   * 3. Fork each worker as a separate OS process running cpu-worker.js
   * 4. Each worker signals 'ready' via IPC when its burn loop starts
   * 5. Set a timeout to auto-kill all workers after durationSeconds
   *
   * PORTING NOTES:
   *   The fork() call creates a new Node.js process. In other runtimes:
   *   - Java: new Thread(() -> { while(running) { doCpuWork(); } }).start()
   *   - Python: multiprocessing.Process(target=burn_cpu).start()
   *   - C#: Task.Run(() => { while(running) { DoCpuWork(); } })
   *
   * @param simulationId - Simulation ID for tracking
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
