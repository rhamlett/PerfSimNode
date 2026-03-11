/**
 * =============================================================================
 * IDLE TIMEOUT SERVICE — Resource-Saving Probe Suspension
 * =============================================================================
 *
 * PURPOSE:
 *   Monitors application activity and suspends health probes when the app
 *   has been idle for a configurable duration. This reduces unnecessary
 *   network traffic, AppLens queries, and Application Insights telemetry
 *   when no one is actively using the dashboard.
 *
 * ACTIVITY SOURCES:
 *   The following events count as "activity" and reset the idle timer:
 *   - Dashboard page loads (initial connection, not automatic reconnections)
 *   - Explicit user activity events from the dashboard (clicks, interactions)
 *   - Load test requests
 *   - Any API request (optional, configurable)
 *
 * IDLE BEHAVIOR:
 *   When idle timeout is reached:
 *   - Health probes are suspended (both localhost and frontend probes)
 *   - Metrics broadcasting continues (minimal cost, useful for debugging)
 *   - The app remains responsive to incoming requests
 *
 * WAKE-UP BEHAVIOR:
 *   When activity is detected after idle:
 *   - Probes resume immediately
 *   - No user action required beyond loading the dashboard
 *
 * CONFIGURATION:
 *   IDLE_TIMEOUT_MINUTES - Minutes of inactivity before idling (default: 20)
 *
 * PORTING NOTES:
 *   - Java: Use ScheduledExecutorService with a single-shot scheduled task
 *     that reschedules itself on each activity. Use AtomicBoolean for idle flag.
 *   - Python: Use asyncio.create_task with asyncio.sleep, canceling/rescheduling
 *     on activity. Use threading.Event for cross-thread idle signaling.
 *   - C#: Use CancellationTokenSource + Task.Delay pattern to create a
 *     resettable timer. Use volatile bool or Interlocked for idle flag.
 *   - The key pattern: a resettable timer that fires once after inactivity,
 *     with a simple flag that external code can poll.
 *
 * @module services/idle-timeout
 */

import { EventLogService } from './event-log.service';

/**
 * Callback type for idle state change notifications.
 */
type IdleStateChangeCallback = (isIdle: boolean) => void;

/**
 * Singleton service for idle timeout management.
 *
 * THREAD SAFETY:
 *   Node.js is single-threaded, so simple flag reads/writes are safe.
 *   In multi-threaded runtimes, use:
 *   - Java: volatile boolean or AtomicBoolean
 *   - C#: volatile bool or Interlocked operations
 *   - Python: threading.Event or Lock-protected variable
 */
class IdleTimeoutServiceClass {
  /** Current idle state */
  private _isIdle = false;

  /** Timestamp of last recorded activity */
  private lastActivityTimestamp: number = Date.now();

  /** Idle timeout in milliseconds (default: 20 minutes) */
  private idleTimeoutMs: number;

  /** Timer handle for the idle check */
  private idleCheckTimer: NodeJS.Timeout | null = null;

  /** Callbacks to notify when idle state changes */
  private stateChangeCallbacks: IdleStateChangeCallback[] = [];

  constructor() {
    // Default: 20 minutes
    // Can be overridden via IDLE_TIMEOUT_MINUTES environment variable
    const envTimeout = process.env.IDLE_TIMEOUT_MINUTES;
    const timeoutMinutes = envTimeout ? parseInt(envTimeout, 10) : 20;

    // Validate the timeout value (minimum 1 minute, maximum 1440 minutes = 24 hours)
    if (isNaN(timeoutMinutes) || timeoutMinutes < 1) {
      console.warn('[IdleTimeout] Invalid IDLE_TIMEOUT_MINUTES, using minimum 1 minute');
      this.idleTimeoutMs = 60000;
    } else if (timeoutMinutes > 1440) {
      console.warn('[IdleTimeout] IDLE_TIMEOUT_MINUTES exceeds 24 hours, capping at 24 hours');
      this.idleTimeoutMs = 1440 * 60 * 1000;
    } else {
      this.idleTimeoutMs = timeoutMinutes * 60 * 1000;
    }

    console.log(`[IdleTimeout] Idle timeout set to ${this.idleTimeoutMs / 1000 / 60} minutes`);
  }

  /**
   * Starts the idle timeout monitoring.
   * Should be called after the server is ready.
   */
  start(): void {
    this.scheduleIdleCheck();
    console.log('[IdleTimeout] Idle monitoring started');
  }

  /**
   * Stops the idle timeout monitoring.
   * Should be called during graceful shutdown.
   */
  stop(): void {
    if (this.idleCheckTimer) {
      clearTimeout(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
    console.log('[IdleTimeout] Idle monitoring stopped');
  }

  /**
   * Records activity, resetting the idle timer.
   *
   * Call this when:
   * - A WebSocket client connects (dashboard load/reload)
   * - A load test request is received
   * - Any other user-initiated action occurs
   *
   * @param source - Optional description of the activity source for logging
   */
  recordActivity(source?: string): void {
    const wasIdle = this._isIdle;
    this.lastActivityTimestamp = Date.now();

    // If we were idle, wake up
    if (wasIdle) {
      this._isIdle = false;
      console.log(`[IdleTimeout] Waking up from idle${source ? ` (${source})` : ''}`);
      EventLogService.info('SERVER_STARTED', 'App waking up from idle state. There may be gaps in diagnostics and logs.', {
        details: { source },
      });
      this.notifyStateChange(false);
    }

    // Reschedule the idle check
    this.scheduleIdleCheck();
  }

  /**
   * Returns the current idle state.
   *
   * @returns true if the app is currently idle
   */
  isIdle(): boolean {
    return this._isIdle;
  }

  /**
   * Returns the configured idle timeout in milliseconds.
   */
  getIdleTimeoutMs(): number {
    return this.idleTimeoutMs;
  }

  /**
   * Returns the time remaining until idle, in milliseconds.
   * Returns 0 if already idle.
   */
  getTimeUntilIdleMs(): number {
    if (this._isIdle) return 0;
    const elapsed = Date.now() - this.lastActivityTimestamp;
    return Math.max(0, this.idleTimeoutMs - elapsed);
  }

  /**
   * Registers a callback to be notified when idle state changes.
   *
   * @param callback - Function called with true when entering idle, false when waking
   */
  onStateChange(callback: IdleStateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Schedules (or reschedules) the idle check timer.
   * The timer fires after idleTimeoutMs of inactivity.
   */
  private scheduleIdleCheck(): void {
    // Clear any existing timer
    if (this.idleCheckTimer) {
      clearTimeout(this.idleCheckTimer);
    }

    // Schedule new check
    this.idleCheckTimer = setTimeout(() => {
      this.checkIdle();
    }, this.idleTimeoutMs);

    // Don't let this timer prevent process exit
    if (this.idleCheckTimer.unref) {
      this.idleCheckTimer.unref();
    }
  }

  /**
   * Checks if the app should transition to idle state.
   * Called by the timer after idleTimeoutMs.
   */
  private checkIdle(): void {
    const elapsed = Date.now() - this.lastActivityTimestamp;

    if (elapsed >= this.idleTimeoutMs) {
      this._isIdle = true;
      const idleMinutes = Math.round(this.idleTimeoutMs / 1000 / 60);
      console.log(`[IdleTimeout] Entering idle state after ${idleMinutes} minutes of inactivity`);
      console.log('[IdleTimeout] Health probes suspended. Load the dashboard to resume.');
      EventLogService.warn('SERVER_STARTED', 'Application going idle, no health probes being sent. There will be gaps in diagnostics and logs.', {
        details: { idleTimeoutMinutes: idleMinutes },
      });
      this.notifyStateChange(true);
    } else {
      // Activity occurred since timer was scheduled, reschedule
      this.scheduleIdleCheck();
    }
  }

  /**
   * Notifies all registered callbacks of a state change.
   */
  private notifyStateChange(isIdle: boolean): void {
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(isIdle);
      } catch (err) {
        console.error('[IdleTimeout] State change callback error:', err);
      }
    }
  }

  /**
   * Gets the current idle status for API/diagnostic purposes.
   */
  getStatus(): { isIdle: boolean; idleTimeoutMs: number; lastActivityMs: number; timeUntilIdleMs: number } {
    return {
      isIdle: this._isIdle,
      idleTimeoutMs: this.idleTimeoutMs,
      lastActivityMs: Date.now() - this.lastActivityTimestamp,
      timeUntilIdleMs: this.getTimeUntilIdleMs(),
    };
  }
}

/**
 * Singleton instance of the idle timeout service.
 */
export const IdleTimeoutService = new IdleTimeoutServiceClass();
