/**
 * Crash Service
 *
 * Simulates application crashes for training purposes.
 *
 * @module services/crash
 */

import { EventLogService } from './event-log.service';

/**
 * Crash Service
 *
 * Provides methods to intentionally crash the process for training.
 */
class CrashServiceClass {
  /**
   * Crashes the process via FailFast (process.abort / SIGABRT).
   *
   * WARNING: This will immediately terminate the Node.js process.
   */
  crashWithFailFast(): void {
    EventLogService.error('SIMULATION_STARTED', 'Crash simulation initiated: FailFast (SIGABRT)', {
      simulationType: 'CRASH_FAILFAST',
      details: { method: 'process.abort()' },
    });

    // Use setImmediate to ensure the log is written before crashing
    setImmediate(() => {
      process.abort();
    });
  }

  /**
   * Crashes the process via stack overflow (infinite recursion).
   *
   * WARNING: This will terminate the Node.js process with a stack overflow.
   * On Azure App Service, this crash type may not auto-recover and requires manual restart.
   */
  crashWithStackOverflow(): void {
    EventLogService.error('SIMULATION_STARTED', 'Crash simulation initiated: stack overflow', {
      simulationType: 'CRASH_STACKOVERFLOW',
      details: { method: 'infinite recursion' },
    });

    // Warn that this crash type requires manual restart on Azure
    EventLogService.warn(
      'CRASH_WARNING',
      'Stack Overflow crashes may not auto-recover on Azure App Service. Manual restart from Azure Portal may be required.',
      { simulationType: 'CRASH_STACKOVERFLOW', details: { recoveryHint: 'Azure Portal > App Service > Restart' } }
    );

    // Use setImmediate to ensure the log is written before crashing
    setImmediate(() => {
      const recurse = (): void => recurse();
      recurse();
    });
  }

  /**
   * Crashes the process via an unhandled exception.
   *
   * WARNING: This will terminate the Node.js process.
   */
  crashWithException(): void {
    EventLogService.error('SIMULATION_STARTED', 'Crash simulation initiated: unhandled exception', {
      simulationType: 'CRASH_EXCEPTION',
      details: { method: 'unhandled exception' },
    });

    // Use setImmediate to ensure the log is written before crashing
    setImmediate(() => {
      throw new Error('Intentional crash: Unhandled exception simulation');
    });
  }

  /**
   * Crashes the process via memory exhaustion (OOM).
   *
   * WARNING: This will terminate the Node.js process with an out-of-memory error.
   * On Azure App Service, this crash type may not auto-recover and requires manual restart.
   */
  crashWithMemoryExhaustion(): void {
    EventLogService.error('SIMULATION_STARTED', 'Crash simulation initiated: memory exhaustion', {
      simulationType: 'CRASH_MEMORY',
      details: { method: 'memory exhaustion (OOM)' },
    });

    // Warn that this crash type requires manual restart on Azure
    EventLogService.warn(
      'CRASH_WARNING',
      'Out of Memory (OOM) crashes may not auto-recover on Azure App Service. Manual restart from Azure Portal may be required.',
      { simulationType: 'CRASH_MEMORY', details: { recoveryHint: 'Azure Portal > App Service > Restart' } }
    );

    // Rapidly allocate memory until OOM
    // Use setImmediate to ensure the log is written before crashing
    setImmediate(() => {
      const allocations: Buffer[] = [];
      try {
        // Allocate 100MB at a time until we can't anymore
        while (true) {
          const buffer = Buffer.alloc(100 * 1024 * 1024); // 100MB
          allocations.push(buffer);
          // Keep the reference to prevent GC
        }
      } catch {
        // This should trigger OOM crash
        throw new Error('Intentional crash: Memory exhaustion simulation');
      }
    });
  }
}

/**
 * Singleton instance of the CrashService.
 */
export const CrashService = new CrashServiceClass();
