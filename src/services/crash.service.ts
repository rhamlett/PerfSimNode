/**
 * =============================================================================
 * CRASH SERVICE — Intentional Process Termination Simulation
 * =============================================================================
 *
 * PURPOSE:
 *   Intentionally crashes the application process using different failure modes.
 *   Each crash type produces a different diagnostic signature in monitoring
 *   tools (Azure AppLens, Application Insights, Event Viewer), helping users
 *   learn to identify crash types from their diagnostics.
 *
 * CRASH TYPES:
 *   1. FailFast (SIGABRT)    → process.abort() — immediate termination,
 *      produces a core dump. Visible as SIGABRT in Azure diagnostics.
 *   2. Stack Overflow         → Infinite recursion until stack space exhausted.
 *      Visible as stack overflow error. May not auto-recover on Azure.
 *   3. Unhandled Exception    → throw new Error() outside a try/catch.
 *      Standard crash, auto-recovers on Azure App Service.
 *   4. Memory Exhaustion (OOM) → Allocate 100MB buffers in a loop until OOM.
 *      Visible as OOM killer in Linux or heap limit error. May not auto-recover.
 *
 * SAFETY:
 *   All crash methods use setImmediate to defer the crash, ensuring the event
 *   log entry and HTTP response are sent BEFORE the process terminates.
 *
 * AZURE BEHAVIOR:
 *   - Azure App Service's process manager automatically restarts the app after
 *     most crash types (exception, SIGABRT).
 *   - Stack Overflow and OOM crashes may leave the container in a bad state
 *     requiring manual restart via the Azure Portal.
 *
 * PORTING NOTES:
 *   - Java: System.exit(1), throw new StackOverflowError(),
 *     OutOfMemoryError (allocate until OOM), Runtime.halt(1)
 *   - Python: sys.exit(1), recursion limit crash, MemoryError,
 *     os.abort() for SIGABRT
 *   - C#: Environment.FailFast(), StackOverflowException,
 *     OutOfMemoryException, throw in unhandled context
 *   - PHP: exit(1), trigger_error(E_ERROR), recursive function
 *
 *   The key is to produce DIFFERENT diagnostic signatures for each crash type
 *   so users can practice identifying them in monitoring tools.
 *
 * @module services/crash
 */

import { EventLogService } from './event-log.service';

/**
 * Crash Service
 *
 * IMPORTANT: All crash methods use setImmediate to defer the actual crash.
 * This ensures the event log entry is written and the HTTP response is sent
 * BEFORE the process terminates. Without this, the client would see a
 * connection reset instead of the 202 response.
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
