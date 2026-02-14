/**
 * Load Test Service
 *
 * Core implementation for the load test endpoint designed for Azure Load Testing.
 * Simulates realistic application behavior that degrades gracefully under load,
 * eventually leading to the 230-second Azure App Service frontend timeout.
 *
 * Algorithm:
 * 1. Increment concurrent counter
 * 2. Allocate memory buffer up front (held for entire request duration)
 * 3. Calculate degradation delay: max(0, concurrent - softLimit) * degradationFactor
 * 4. Interleave CPU work and brief sleeps until total duration reached
 * 5. After 120s elapsed, 20% chance per check of throwing a random exception
 * 6. Decrement counter in finally block
 * 7. Return result with timing details
 *
 * @module services/load-test
 */

import {
  LoadTestRequest,
  LoadTestResult,
  LoadTestStats,
  LoadTestStatsData,
} from '../types';

// =============================================================================
// RANDOM EXCEPTION POOL
// =============================================================================
// Simulates diverse real-world application failures.

const EXCEPTION_FACTORIES: Array<() => Error> = [
  // Common application logic errors
  () => new Error('InvalidOperationError: Operation is not valid due to current state'),
  () => new TypeError('Value does not fall within the expected range'),
  () => new TypeError('Cannot read properties of null'),

  // Classic JS errors
  () => new ReferenceError('Object reference not set to an instance of an object'),
  () => new RangeError('Index was outside the bounds of the array'),
  () => new Error('KeyNotFoundError: The given key was not present in the dictionary'),

  // I/O and network-related
  () => new Error('TimeoutError: The operation has timed out'),
  () => new Error('IOException: Unable to read data from the transport connection'),
  () => new Error('HttpRequestError: An error occurred while sending the request'),

  // Math and format errors
  () => new RangeError('Attempted to divide by zero'),
  () => new SyntaxError('Input string was not in a correct format'),
  () => new RangeError('Arithmetic operation resulted in an overflow'),

  // Async-related
  () => new Error('AbortError: The operation was aborted'),
  () => new Error('OperationCancelledError: The operation was canceled'),

  // Scary ones
  () => new Error('OutOfMemoryError: Insufficient memory to continue execution'),
  () => new Error('StackOverflowError: Maximum call stack size exceeded'),
];

// =============================================================================
// CONSTANTS
// =============================================================================

/** Time threshold in seconds after which exceptions may be thrown */
const EXCEPTION_THRESHOLD_SECONDS = 120;

/** Probability (0.0 to 1.0) of throwing exception per check after threshold */
const EXCEPTION_PROBABILITY = 0.20;

/** Milliseconds of sleep per cycle in the sustained work loop */
const SLEEP_PER_CYCLE_MS = 50;

/** Interval in seconds between event log broadcasts */
const BROADCAST_INTERVAL_SECONDS = 60;

// =============================================================================
// DEFAULT REQUEST VALUES
// =============================================================================

const DEFAULT_REQUEST: LoadTestRequest = {
  workIterations: 200,
  bufferSizeKb: 20000,
  baselineDelayMs: 500,
  softLimit: 25,
  degradationFactor: 500,
};

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

/**
 * Singleton service for load test endpoint work simulation.
 *
 * Node.js is single-threaded so simple counters are thread-safe.
 * The service maintains lifetime and period statistics and can broadcast
 * periodic stats via a configurable callback (e.g., Socket.IO).
 */
class LoadTestServiceClass {
  // ---- Lifetime counters ----
  private concurrentRequests = 0;
  private totalRequestsProcessed = 0;
  private totalExceptionsThrown = 0;
  private totalResponseTimeMs = 0;

  // ---- Period stats (reset each broadcast) ----
  private periodRequestsCompleted = 0;
  private periodResponseTimeSum = 0;
  private periodMaxResponseTimeMs = 0;
  private periodPeakConcurrent = 0;
  private periodExceptions = 0;

  // ---- Broadcast timer ----
  private broadcastTimer: NodeJS.Timeout | null = null;
  private statsBroadcaster: ((data: LoadTestStatsData) => void) | null = null;

  constructor() {
    // Start periodic broadcast timer (60 seconds)
    this.broadcastTimer = setInterval(() => {
      this.broadcastStats();
    }, BROADCAST_INTERVAL_SECONDS * 1000);

    // Don't let this timer prevent process exit
    if (this.broadcastTimer.unref) {
      this.broadcastTimer.unref();
    }
  }

  /**
   * Sets the broadcaster function for periodic stats emission.
   * Typically wired to Socket.IO's emit.
   */
  setStatsBroadcaster(fn: (data: LoadTestStatsData) => void): void {
    this.statsBroadcaster = fn;
  }

  /**
   * Returns the default request parameters.
   */
  getDefaults(): LoadTestRequest {
    return { ...DEFAULT_REQUEST };
  }

  // =========================================================================
  // MAIN ALGORITHM: ExecuteWorkAsync
  // =========================================================================

  /**
   * Executes the load test work with the specified parameters.
   *
   * @param request - Configuration for the load test behavior
   * @returns Result containing timing and diagnostic information
   */
  async executeWork(request: Partial<LoadTestRequest> = {}): Promise<LoadTestResult> {
    // Merge with defaults
    const params: LoadTestRequest = {
      workIterations: request.workIterations ?? DEFAULT_REQUEST.workIterations,
      bufferSizeKb: request.bufferSizeKb ?? DEFAULT_REQUEST.bufferSizeKb,
      baselineDelayMs: request.baselineDelayMs ?? DEFAULT_REQUEST.baselineDelayMs,
      softLimit: request.softLimit ?? DEFAULT_REQUEST.softLimit,
      degradationFactor: request.degradationFactor ?? DEFAULT_REQUEST.degradationFactor,
    };

    // Increment concurrent counter
    this.concurrentRequests++;
    const currentConcurrent = this.concurrentRequests;
    this.updatePeakConcurrent(currentConcurrent);

    const startTime = Date.now();
    let totalCpuWorkDone = 0;
    let workCompleted = false;
    let buffer: Buffer | null = null;

    try {
      // -----------------------------------------------------------------
      // STEP 1: ALLOCATE MEMORY UP FRONT
      // Allocate at the START and hold for the entire request duration.
      // This ensures memory scales with concurrent requests.
      // -----------------------------------------------------------------
      const bufferSize = params.bufferSizeKb * 1024;
      buffer = Buffer.alloc(bufferSize); // zero-filled allocation
      this.touchMemoryBuffer(buffer);

      // -----------------------------------------------------------------
      // STEP 2: CALCULATE TOTAL REQUEST DURATION
      // Formula: baselineDelayMs + max(0, concurrent - softLimit) * degradationFactor
      // -----------------------------------------------------------------
      const overLimit = Math.max(0, currentConcurrent - params.softLimit);
      const degradationDelayMs = overLimit * params.degradationFactor;
      const totalDurationMs = params.baselineDelayMs + degradationDelayMs;

      // -----------------------------------------------------------------
      // STEP 3: SUSTAINED WORK LOOP
      // Interleave CPU work and brief sleeps until total duration reached.
      // CPU work per cycle = workIterations / 100 ms
      // -----------------------------------------------------------------
      const cpuWorkMsPerCycle = params.workIterations / 100;

      while (Date.now() - startTime < totalDurationMs) {
        // CPU work phase
        if (cpuWorkMsPerCycle > 0) {
          this.performCpuWork(cpuWorkMsPerCycle);
          totalCpuWorkDone += cpuWorkMsPerCycle;
        }

        // Keep memory active
        this.touchMemoryBuffer(buffer);

        // Check for timeout exception (20% chance after 120s)
        this.checkAndThrowTimeoutException(startTime);

        // Sleep phase (yield to event loop, prevents 100% CPU)
        const remainingMs = totalDurationMs - (Date.now() - startTime);
        const sleepMs = Math.min(SLEEP_PER_CYCLE_MS, Math.max(0, remainingMs));
        if (sleepMs > 0) {
          await this.sleep(sleepMs);
        }
      }

      // Final memory touch before returning
      this.touchMemoryBuffer(buffer);

      workCompleted = true;
      const elapsedMs = Date.now() - startTime;

      return this.buildResult(
        elapsedMs,
        currentConcurrent,
        elapsedMs,
        totalCpuWorkDone,
        buffer.length,
        workCompleted,
        false,
        null
      );
    } catch (error) {
      const elapsedMs = Date.now() - startTime;
      this.totalExceptionsThrown++;
      this.periodExceptions++;

      const errorName = error instanceof Error ? error.constructor.name : 'Error';
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.warn(
        `[LoadTest] Exception after ${elapsedMs}ms: ${errorName} - ${errorMessage}`
      );

      // Re-throw to let Express error handler produce 500
      throw error;
    } finally {
      // Memory (buffer) is released here when the reference goes out of scope.
      // Counter updates
      this.concurrentRequests--;
      this.totalRequestsProcessed++;
      const elapsedMs = Date.now() - startTime;
      this.totalResponseTimeMs += elapsedMs;

      // Period stats
      this.periodRequestsCompleted++;
      this.periodResponseTimeSum += elapsedMs;
      this.updateMaxResponseTime(elapsedMs);

      // Allow buffer to be GC'd
      buffer = null;
    }
  }

  // =========================================================================
  // STATISTICS
  // =========================================================================

  /**
   * Gets current load test statistics without performing any work.
   */
  getCurrentStats(): LoadTestStats {
    const avgResponseTime =
      this.totalRequestsProcessed > 0
        ? this.totalResponseTimeMs / this.totalRequestsProcessed
        : 0;

    return {
      currentConcurrentRequests: this.concurrentRequests,
      totalRequestsProcessed: this.totalRequestsProcessed,
      totalExceptionsThrown: this.totalExceptionsThrown,
      averageResponseTimeMs: Math.round(avgResponseTime * 100) / 100,
    };
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Touches all pages in the memory buffer to keep it active.
   * Prevents the runtime from optimizing away the allocation.
   */
  private touchMemoryBuffer(buffer: Buffer): void {
    // XOR through buffer every 4096 bytes (one per memory page)
    for (let i = 0; i < buffer.length; i += 4096) {
      buffer[i] = buffer[i] ^ 0xff;
    }
  }

  /**
   * Checks if elapsed time exceeds 120s threshold and randomly throws an exception.
   * 20% probability per check after threshold.
   */
  private checkAndThrowTimeoutException(startTime: number): void {
    const elapsedSeconds = (Date.now() - startTime) / 1000;

    if (elapsedSeconds > EXCEPTION_THRESHOLD_SECONDS) {
      if (Math.random() < EXCEPTION_PROBABILITY) {
        const idx = Math.floor(Math.random() * EXCEPTION_FACTORIES.length);
        const exception = EXCEPTION_FACTORIES[idx]();
        console.log(
          `[LoadTest] Throwing random exception after ${elapsedSeconds.toFixed(1)}s: ${exception.message}`
        );
        throw exception;
      }
    }
  }

  /**
   * Performs CPU-intensive work using a spin loop for the specified duration.
   * Burns CPU cycles without yielding to the event loop.
   *
   * @param workMs - Milliseconds of CPU work to perform
   */
  private performCpuWork(workMs: number): void {
    if (workMs <= 0) return;
    const endTime = Date.now() + workMs;
    // Spin loop: busy-wait consuming CPU
    while (Date.now() < endTime) {
      // Intentionally empty - burns CPU cycles
      // The Date.now() call itself prevents V8 from optimizing this away
    }
  }

  /**
   * Async sleep helper that yields to the event loop.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Builds the load test result object.
   */
  private buildResult(
    elapsedMs: number,
    concurrentRequests: number,
    degradationDelayMs: number,
    totalCpuWork: number,
    bufferSizeBytes: number,
    workCompleted: boolean,
    exceptionThrown: boolean,
    exceptionType: string | null
  ): LoadTestResult {
    return {
      elapsedMs,
      concurrentRequestsAtStart: concurrentRequests,
      degradationDelayAppliedMs: degradationDelayMs,
      workIterationsCompleted: workCompleted ? totalCpuWork : 0,
      memoryAllocatedBytes: workCompleted ? bufferSizeBytes : 0,
      workCompleted,
      exceptionThrown,
      exceptionType,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Broadcasts period stats via the configured broadcaster.
   * Only broadcasts if there was activity during the period.
   */
  private broadcastStats(): void {
    const requestsCompleted = this.periodRequestsCompleted;

    if (requestsCompleted === 0) {
      return; // No activity, skip broadcast
    }

    const responseTimeSum = this.periodResponseTimeSum;
    const maxResponseTime = this.periodMaxResponseTimeMs;
    const peakConcurrent = this.periodPeakConcurrent;
    const exceptions = this.periodExceptions;
    const currentConcurrent = this.concurrentRequests;

    // Calculate averages
    const avgResponseTime =
      requestsCompleted > 0 ? responseTimeSum / requestsCompleted : 0;
    const requestsPerSecond = requestsCompleted / BROADCAST_INTERVAL_SECONDS;

    const statsData: LoadTestStatsData = {
      currentConcurrent,
      peakConcurrent,
      requestsCompleted,
      avgResponseTimeMs: Math.round(avgResponseTime * 100) / 100,
      maxResponseTimeMs: maxResponseTime,
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
      exceptionCount: exceptions,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `[LoadTest] Broadcasting stats: ${requestsCompleted} requests, ${avgResponseTime.toFixed(1)}ms avg, ${maxResponseTime}ms max, ${requestsPerSecond.toFixed(2)} RPS`
    );

    // Emit via broadcaster
    if (this.statsBroadcaster) {
      this.statsBroadcaster(statsData);
    }

    // Reset period stats
    this.periodRequestsCompleted = 0;
    this.periodResponseTimeSum = 0;
    this.periodMaxResponseTimeMs = 0;
    this.periodPeakConcurrent = 0;
    this.periodExceptions = 0;
  }

  /**
   * Updates peak concurrent requests for the current period.
   */
  private updatePeakConcurrent(current: number): void {
    if (current > this.periodPeakConcurrent) {
      this.periodPeakConcurrent = current;
    }
  }

  /**
   * Updates max response time for the current period.
   */
  private updateMaxResponseTime(responseTimeMs: number): void {
    if (responseTimeMs > this.periodMaxResponseTimeMs) {
      this.periodMaxResponseTimeMs = responseTimeMs;
    }
  }
}

/**
 * Singleton instance of the Load Test Service.
 */
export const LoadTestService = new LoadTestServiceClass();
