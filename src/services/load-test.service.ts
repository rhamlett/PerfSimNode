/**
 * =============================================================================
 * LOAD TEST SERVICE — Simulated Application Under Load
 * =============================================================================
 *
 * PURPOSE:
 *   Provides a load test endpoint designed for Azure Load Testing (or similar
 *   tools like JMeter, k6, Gatling). Simulates realistic application behavior
 *   that degrades gracefully under increasing concurrency, eventually leading
 *   to the 230-second Azure App Service frontend timeout.
 *
 * ALGORITHM (per request):
 *   1. INCREMENT concurrent request counter (atomic in single-threaded Node.js)
 *   2. ALLOCATE MEMORY: split 50/50 between V8 heap and native Buffer
 *      - Heap half: visible in heapUsed/Memory Working Set, causes GC pauses
 *      - Native half: visible in RSS, causes OS paging under load
 *   3. CALCULATE TOTAL DELAY:
 *      totalDelay = baselineDelayMs + max(0, concurrent - softLimit) * degradationFactor
 *      Example with defaults: 30 concurrent = 1000 + (30-20)*1000 = 11000ms
 *   4. SUSTAINED WORK LOOP: interleave CPU work and brief async sleeps
 *      - CPU work: spin loop for (workIterations/10)ms per cycle
 *      - Sleep: 50ms yield to event loop between cycles
 *      - Touch memory each cycle to prevent GC/OS page reclamation
 *   5. CONCURRENCY-BASED ERROR INJECTION (configurable via errorAboveConcurrent and errorPercent):
 *      When concurrent requests exceed errorAboveConcurrent threshold, errorPercent
 *      chance of throwing a random exception from a pool of realistic error types.
 *      This simulates system instability under high load - the more overloaded
 *      the system, the more likely errors occur.
 *   6. DECREMENT counter in finally block; return timing diagnostics
 *
 * EXCEPTION POOL:
 *   17 different exception types simulating real-world failures:
 *   - InvalidOperationError, TypeError, ReferenceError, TimeoutError,
 *     IOException, HttpRequestError, StackOverflowError, etc.
 *   These produce diverse error signatures in Application Insights.
 *
 * STATISTICS:
 *   Tracks lifetime and per-period statistics:
 *   - Concurrent requests, total processed, total exceptions
 *   - Period stats (60s windows) broadcast via Socket.IO
 *
 * PORTING NOTES:
 *   - The concurrent counter is a simple integer here because Node.js is
 *     single-threaded. In multi-threaded runtimes:
 *     Java: AtomicInteger; C#: Interlocked.Increment; Python: threading.Lock
 *   - Memory allocation should split between managed heap and native memory
 *     to produce both GC pressure and RSS growth.
 *   - The degradation formula is the core behavior to replicate:
 *     delay = baseline + max(0, current - softLimit) * factor
 *   - Exception pool: use the target language's exception hierarchy
 *   - Stats broadcasting: periodic timer that emits to WebSocket/SSE
 *   - Concurrency-based errors: check concurrent count against threshold
 *
 * @module services/load-test
 */

import {
  LoadTestRequest,
  LoadTestResult,
  LoadTestStats,
  LoadTestStatsData,
} from '../types';
import { EventLogService } from './event-log.service';

// =============================================================================
// RANDOM EXCEPTION POOL
// =============================================================================
// Simulates diverse real-world application failures for load testing.
// When a request has been processing for >120 seconds, there is a 20% chance
// per work cycle that one of these exceptions is thrown. This produces varied
// error signatures in Application Insights and other monitoring tools.
//
// PORTING NOTES:
//   Replace these with equivalent exception types in the target language:
//   - Java: IllegalStateException, NullPointerException, SocketTimeoutException, etc.
//   - Python: ValueError, TypeError, TimeoutError, ConnectionError, etc.
//   - C#: InvalidOperationException, NullReferenceException, TimeoutException, etc.
//   - PHP: RuntimeException, InvalidArgumentException, DomainException, etc.

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

/** Milliseconds of sleep per cycle in the sustained work loop */
const SLEEP_PER_CYCLE_MS = 50;

/** Interval in seconds between event log broadcasts */
const BROADCAST_INTERVAL_SECONDS = 60;

// =============================================================================
// DEFAULT REQUEST VALUES
// =============================================================================

const DEFAULT_REQUEST: LoadTestRequest = {
  workIterations: 700,
  bufferSizeKb: 10000,
  baselineDelayMs: 1000,
  softLimit: 20,
  degradationFactor: 1000,
  errorAboveConcurrent: 0,  // Disabled by default
  errorPercent: 20,
  suppressLogs: false,
};

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

/**
 * Singleton service for load test endpoint work simulation.
 *
 * THREAD SAFETY:
 *   Node.js is single-threaded, so simple counters are naturally thread-safe.
 *   In multi-threaded runtimes (Java, C#), use atomic operations:
 *   - Java: AtomicInteger for counters, AtomicLong for sums
 *   - C#: Interlocked.Increment/Decrement for counters
 *   - Python: threading.Lock around counter operations
 *
 * STATISTICS TRACKING:
 *   Two tiers of statistics:
 *   1. Lifetime counters — never reset, used for /api/loadtest/stats endpoint
 *   2. Period counters — reset every 60s after broadcasting via Socket.IO
 *
 * LATENCY SAMPLING:
 *   Individual load test request latencies are sampled at 1:10 (10%) and
 *   broadcast via Socket.IO for the dashboard latency monitor. This prevents
 *   flooding the monitor while still showing representative latency data.
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

  // ---- In-flight request tracking ----
  // Tracks start times of all currently executing requests.
  // Used to report "max in-flight duration" which shows when requests
  // have been running for 20+ seconds even before they complete.
  // This aligns our reported stats with what Azure Load Testing observes.
  private inFlightRequestIds = new Map<number, number>(); // requestId -> startTime
  private nextRequestId = 0;

  // ---- Sidecar probe latency tracking ----
  // The sidecar measures actual HTTP round-trip time including queue delay.
  // We use this to estimate total request latency for load test stats.
  private recentProbeLatencies: number[] = [];
  private readonly MAX_PROBE_SAMPLES = 120; // ~60 seconds at 500ms interval

  // ---- Latency sampling (1 in 10 requests to avoid flooding monitor) ----
  private requestSampleCounter = 0;
  private readonly LATENCY_SAMPLE_RATE = 10; // 1 in 10 requests sampled

  // ---- Broadcast timer ----
  private broadcastTimer: NodeJS.Timeout | null = null;
  private statsBroadcaster: ((data: LoadTestStatsData) => void) | null = null;
  private latencyBroadcaster: ((latencyMs: number) => void) | null = null;

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
   * Sets the broadcaster function for individual request latencies.
   * Used to feed sampled load test latencies to the dashboard latency monitor.
   * Sampling is 1:10 (10% of requests) to avoid flooding the monitor.
   */
  setLatencyBroadcaster(fn: (latencyMs: number) => void): void {
    this.latencyBroadcaster = fn;
  }

  /**
   * Records a sidecar probe latency measurement.
   * The sidecar measures actual HTTP round-trip time including event loop queue delay.
   * We use these measurements to estimate total request latency for load test stats,
   * since we can only measure processing time from within the main event loop.
   */
  recordProbeLatency(latencyMs: number): void {
    this.recentProbeLatencies.push(latencyMs);
    if (this.recentProbeLatencies.length > this.MAX_PROBE_SAMPLES) {
      this.recentProbeLatencies.shift();
    }
  }

  /**
   * Gets the average recent probe latency, which approximates HTTP queue delay.
   */
  private getAverageProbeLatency(): number {
    if (this.recentProbeLatencies.length === 0) return 0;
    const sum = this.recentProbeLatencies.reduce((a, b) => a + b, 0);
    return sum / this.recentProbeLatencies.length;
  }

  /**
   * Gets the maximum recent probe latency.
   */
  private getMaxProbeLatency(): number {
    if (this.recentProbeLatencies.length === 0) return 0;
    return Math.max(...this.recentProbeLatencies);
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
   * @param arrivalTime - Optional timestamp when Express received the request.
   *                      Used for accurate stats that include HTTP queue time.
   * @returns Result containing timing and diagnostic information
   */
  async executeWork(request: Partial<LoadTestRequest> = {}, arrivalTime?: number): Promise<LoadTestResult> {
    // Merge with defaults
    const params: LoadTestRequest = {
      workIterations: request.workIterations ?? DEFAULT_REQUEST.workIterations,
      bufferSizeKb: request.bufferSizeKb ?? DEFAULT_REQUEST.bufferSizeKb,
      baselineDelayMs: request.baselineDelayMs ?? DEFAULT_REQUEST.baselineDelayMs,
      softLimit: request.softLimit ?? DEFAULT_REQUEST.softLimit,
      degradationFactor: request.degradationFactor ?? DEFAULT_REQUEST.degradationFactor,
      errorAboveConcurrent: request.errorAboveConcurrent ?? DEFAULT_REQUEST.errorAboveConcurrent,
      errorPercent: request.errorPercent ?? DEFAULT_REQUEST.errorPercent,
      suppressLogs: request.suppressLogs ?? DEFAULT_REQUEST.suppressLogs,
    };

    // Increment concurrent counter
    this.concurrentRequests++;
    const currentConcurrent = this.concurrentRequests;
    this.updatePeakConcurrent(currentConcurrent);

    // Track two separate timestamps:
    // 1. statsStartTime - for calculating elapsed time in stats
    // 2. workStartTime - when executeWork actually starts running
    //    Used for work loop duration so requests still do their intended work
    const statsStartTime = arrivalTime ?? Date.now();
    const workStartTime = Date.now();
    
    const requestId = this.nextRequestId++;
    this.inFlightRequestIds.set(requestId, statsStartTime);
    let totalCpuWorkDone = 0;
    let workCompleted = false;
    let heapMemory: number[][] | null = null;
    let nativeBuffer: Buffer | null = null;
    const allocatedBytes = params.bufferSizeKb * 1024;

    try {
      // -----------------------------------------------------------------
      // STEP 1: ALLOCATE MEMORY — SPLIT 50/50 BETWEEN HEAP AND NATIVE
      //
      // V8 heap half (JS arrays): visible in heapUsed / Memory Working Set,
      //   triggers GC pauses that cause event loop lag spikes.
      // Native half (Buffer): visible in RSS only, adds OS-level memory
      //   pressure that can cause paging/swapping under load.
      // Both halves contribute to RSS.
      // -----------------------------------------------------------------
      const heapKb = Math.ceil(params.bufferSizeKb / 2);
      const nativeKb = params.bufferSizeKb - heapKb;

      // Capture memory before allocation for diagnostics
      const memBefore = process.memoryUsage();

      heapMemory = this.allocateHeapMemory(heapKb);
      this.touchHeapMemory(heapMemory);

      nativeBuffer = Buffer.alloc(nativeKb * 1024);
      this.touchNativeBuffer(nativeBuffer);

      // Log allocation results (helps diagnose bufferSizeKb issues)
      const memAfter = process.memoryUsage();
      const heapDeltaMb = (memAfter.heapUsed - memBefore.heapUsed) / (1024 * 1024);
      const rssDeltaMb = (memAfter.rss - memBefore.rss) / (1024 * 1024);
      console.log(
        `[LoadTest] Memory allocated: requested=${params.bufferSizeKb}KB ` +
        `(${heapKb}KB heap, ${nativeKb}KB native), ` +
        `actual delta: heap=${heapDeltaMb.toFixed(1)}MB, rss=${rssDeltaMb.toFixed(1)}MB, ` +
        `concurrent=${currentConcurrent}`
      );

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
      // CPU work per cycle = workIterations / 10 ms
      // Default 200 → 20ms spin per 70ms cycle ≈ 28% CPU duty per request
      // -----------------------------------------------------------------
      const cpuWorkMsPerCycle = params.workIterations / 10;

      // Work loop uses workStartTime so it runs for full duration even after queue delay
      while (Date.now() - workStartTime < totalDurationMs) {
        // CPU work phase
        if (cpuWorkMsPerCycle > 0) {
          this.performCpuWork(cpuWorkMsPerCycle);
          totalCpuWorkDone += cpuWorkMsPerCycle;
        }

        // Keep memory active
        this.touchHeapMemory(heapMemory);
        this.touchNativeBuffer(nativeBuffer);

        // Sleep phase (yield to event loop, prevents 100% CPU)
        const remainingMs = totalDurationMs - (Date.now() - workStartTime);
        const sleepMs = Math.min(SLEEP_PER_CYCLE_MS, Math.max(0, remainingMs));
        if (sleepMs > 0) {
          await this.sleep(sleepMs);
        }
      }

      // Check for concurrency-based error injection after work completes
      // This simulates system instability under high load
      this.checkAndThrowConcurrencyException(currentConcurrent, params.errorAboveConcurrent, params.errorPercent, params.suppressLogs);

      // Final memory touch before returning
      this.touchHeapMemory(heapMemory);
      this.touchNativeBuffer(nativeBuffer);

      workCompleted = true;
      // Use statsStartTime for elapsed time to match Azure Load Testing measurement
      const elapsedMs = Date.now() - statsStartTime;

      return this.buildResult(
        elapsedMs,
        currentConcurrent,
        elapsedMs,
        totalCpuWorkDone,
        allocatedBytes,
        workCompleted,
        false,
        null
      );
    } catch (error) {
      const elapsedMs = Date.now() - statsStartTime;
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
      // Remove from in-flight tracking
      this.inFlightRequestIds.delete(requestId);

      // Memory (buffer) is released here when the reference goes out of scope.
      // Counter updates
      this.concurrentRequests--;
      this.totalRequestsProcessed++;
      // Use statsStartTime for elapsed time to match Azure Load Testing measurement
      const elapsedMs = Date.now() - statsStartTime;
      this.totalResponseTimeMs += elapsedMs;

      // Period stats
      this.periodRequestsCompleted++;
      this.periodResponseTimeSum += elapsedMs;
      this.updateMaxResponseTime(elapsedMs);

      // Latency sampling (1 in 10 requests) for dashboard latency monitor
      // This prevents flooding the monitor while still showing load test latencies
      this.requestSampleCounter++;
      if (this.requestSampleCounter >= this.LATENCY_SAMPLE_RATE) {
        this.requestSampleCounter = 0;
        if (this.latencyBroadcaster) {
          this.latencyBroadcaster(elapsedMs);
        }
      }

      // Allow memory to be GC'd / released
      heapMemory = null;
      nativeBuffer = null;
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
   * Allocates memory on the V8 heap using regular JS arrays.
   *
   * Unlike Buffer/TypedArray (which use native/external memory),
   * these arrays live on the V8 heap and show in heapUsed metrics.
   * This is important because heapUsed maps to Azure's "Memory Working Set"
   * metric, and heap growth triggers GC pauses that cause event loop lag.
   *
   * STRUCTURE: Array of number[128] chunks, where each chunk ≈ 1 KB.
   * Using Math.random() ensures V8 stores actual heap-allocated doubles,
   * not Small Integer (SMI) optimizations.
   *
   * PORTING NOTES:
   *   Allocate managed heap objects (not native memory) so the runtime's
   *   GC metrics reflect the allocation. Use the runtime's equivalent:
   *   - Java: new byte[1024] arrays in an ArrayList
   *   - C#: new byte[1024] arrays in a List
   *   - Python: list of bytearray(1024) objects
   *
   * @param sizeKb - Amount of memory to allocate in kilobytes
   * @returns Array of number arrays residing on the V8 heap
   */
  private allocateHeapMemory(sizeKb: number): number[][] {
    const memory: number[][] = new Array(sizeKb);
    for (let i = 0; i < sizeKb; i++) {
      // 128 doubles × 8 bytes = 1024 bytes ≈ 1 KB per chunk
      const chunk = new Array<number>(128);
      for (let j = 0; j < 128; j++) {
        chunk[j] = Math.random(); // heap-allocated doubles, not SMIs
      }
      memory[i] = chunk;
    }
    return memory;
  }

  /**
   * Touches heap memory periodically to prevent GC from collecting it.
   * Mutates values to ensure V8 cannot optimize the allocation away.
   */
  private touchHeapMemory(memory: number[][]): void {
    // Touch every 4th chunk (~one per 4 KB, similar to page touching)
    for (let i = 0; i < memory.length; i += 4) {
      memory[i][0] = memory[i][0] + 0.001;
    }
  }

  /**
   * Touches native Buffer memory to keep pages resident and prevent
   * the OS from reclaiming them. XORs one byte per 4 KB page.
   */
  private touchNativeBuffer(buffer: Buffer): void {
    for (let i = 0; i < buffer.length; i += 4096) {
      buffer[i] = buffer[i] ^ 0xff;
    }
  }

  /**
   * Checks if concurrent requests exceed threshold and randomly throws an exception.
   * This simulates system instability under high load - the more overloaded
   * the system becomes, the more likely errors occur.
   * 
   * @param currentConcurrent - Current number of concurrent requests
   * @param errorAboveConcurrent - Threshold above which errors may be thrown
   *                               (0 = disabled, -1 = always inject errors)
   * @param errorPercent - Percentage chance (0-100) of throwing exception when above threshold
   * @param suppressLogs - When true, suppress event log messages (for internal callers)
   */
  private checkAndThrowConcurrencyException(
    currentConcurrent: number,
    errorAboveConcurrent: number,
    errorPercent: number,
    suppressLogs?: boolean
  ): void {
    // Skip if error injection is disabled (threshold is 0 or percent is 0)
    if (errorAboveConcurrent === 0 || errorPercent <= 0) {
      return;
    }

    // Special case: errorAboveConcurrent < 0 means "always inject errors"
    // This is used by the failed request simulation to guarantee HTTP 5xx
    const shouldInject = errorAboveConcurrent < 0 || currentConcurrent > errorAboveConcurrent;

    if (shouldInject) {
      const probability = errorPercent / 100;
      if (Math.random() < probability) {
        const idx = Math.floor(Math.random() * EXCEPTION_FACTORIES.length);
        const exception = EXCEPTION_FACTORIES[idx]();
        // Log to event log so it appears in dashboard (unless suppressed)
        if (!suppressLogs) {
          EventLogService.warn(
            'LOAD_TEST_ERROR_INJECTED',
            `Injecting error (concurrent=${currentConcurrent} > threshold=${errorAboveConcurrent}): ${exception.message}`
          );
        }
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

    if (requestsCompleted === 0 && this.inFlightRequestIds.size === 0) {
      return; // No activity and no in-flight requests, skip broadcast
    }

    const peakConcurrent = this.periodPeakConcurrent;
    const exceptions = this.periodExceptions;
    const currentConcurrent = this.concurrentRequests;
    const requestsPerSecond = requestsCompleted / BROADCAST_INTERVAL_SECONDS;

    // Get sidecar probe latency - this is the AUTHORITATIVE measurement
    // The sidecar runs in a separate process with its own unblocked event loop,
    // so it can accurately measure HTTP round-trip time including queue delay.
    // This is the same latency shown in the Request Latency Monitor.
    const avgServerLatency = this.getAverageProbeLatency();
    const maxServerLatency = this.getMaxProbeLatency();

    const statsData: LoadTestStatsData = {
      currentConcurrent,
      peakConcurrent,
      requestsCompleted,
      avgResponseTimeMs: Math.round(avgServerLatency * 100) / 100,
      maxResponseTimeMs: Math.round(maxServerLatency),
      maxInFlightMs: 0, // Not needed when using sidecar measurements
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
      exceptionCount: exceptions,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `[LoadTest] Broadcasting stats: ${requestsCompleted} requests, server latency ${avgServerLatency.toFixed(0)}ms avg / ${maxServerLatency.toFixed(0)}ms max (sidecar-measured), ${requestsPerSecond.toFixed(2)} RPS`
    );

    // Calculate error percentage for display
    const errorPercent = requestsCompleted > 0 
      ? ((exceptions / requestsCompleted) * 100).toFixed(1)
      : '0.0';

    // Write to event log so it appears in the dashboard
    // Report sidecar-measured latency as authoritative - this matches Azure Load Testing
    EventLogService.info(
      'LOAD_TEST_STATS',
      `Load test period stats (60s): ${requestsCompleted} requests, ${statsData.avgResponseTimeMs} avg ms, ${statsData.maxResponseTimeMs} max ms (sidecar), ${statsData.requestsPerSecond} RPS, peak ${peakConcurrent} concurrent, ${errorPercent}% errors`,
      {
        details: {
          requestsCompleted,
          avgResponseTimeMs: statsData.avgResponseTimeMs,
          maxResponseTimeMs: statsData.maxResponseTimeMs,
          currentConcurrent,
          peakConcurrent,
          requestsPerSecond: statsData.requestsPerSecond,
          exceptionCount: exceptions,
          errorPercent: parseFloat(errorPercent),
          measurementSource: 'sidecar',
        },
      }
    );

    // Emit via broadcaster
    if (this.statsBroadcaster) {
      this.statsBroadcaster(statsData);
    }

    // Reset period stats (but NOT probe latencies - keep accumulating for accuracy)
    this.periodRequestsCompleted = 0;
    this.periodResponseTimeSum = 0;
    this.periodMaxResponseTimeMs = 0;
    this.periodPeakConcurrent = 0;
    this.periodExceptions = 0;
    this.recentProbeLatencies = [];
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
