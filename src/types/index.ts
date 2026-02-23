/**
 * =============================================================================
 * DATA MODEL — Types and Interfaces
 * =============================================================================
 *
 * PURPOSE:
 *   Central type definitions for the entire PerfSimNode application. Every data
 *   structure exchanged between controllers, services, WebSocket events, and the
 *   frontend dashboard is defined here.
 *
 * ARCHITECTURE ROLE:
 *   This is the "contract" layer. All API request/response shapes, simulation
 *   parameters, metrics snapshots, and event log entries are typed here.
 *   Controllers validate incoming data against these types, services produce
 *   data conforming to them, and the frontend consumes them via REST + WebSocket.
 *
 * PORTING NOTES:
 *   - In Java, these would be POJOs or records; in C#, record classes or DTOs.
 *   - In Python, use dataclasses or Pydantic models for validation.
 *   - In PHP, use typed classes or array shapes (PHP 8.1+ enums for union types).
 *   - Union/discriminated types (SimulationParameters) map to sealed classes (Kotlin),
 *     sealed interfaces (Java 17+), or tagged unions with a discriminator field.
 *   - String literal unions (SimulationType, LogLevel) become enums in most languages.
 *
 * @module types
 */

// =============================================================================
// ENUMERATIONS (string literal unions → enums in other languages)
// =============================================================================

/**
 * Types of performance simulations available in the system.
 *
 * Each type corresponds to a distinct simulation service and API endpoint:
 *   - CPU_STRESS:          Spawns OS-level worker processes to burn CPU cores
 *   - MEMORY_PRESSURE:     Allocates V8 heap objects to consume memory
 *   - EVENT_LOOP_BLOCKING: Runs synchronous crypto in the main thread to block I/O
 *   - SLOW_REQUEST:        Delays HTTP responses using various blocking strategies
 *   - CRASH_*:             Intentionally terminates the process via different failure modes
 *
 * PORTING NOTES:
 *   Use a string-backed enum. The values are stored in simulation records and
 *   serialized to JSON in API responses and WebSocket events.
 */
export type SimulationType =
  | 'CPU_STRESS'
  | 'MEMORY_PRESSURE'
  | 'EVENT_LOOP_BLOCKING'
  | 'SLOW_REQUEST'
  | 'CRASH_EXCEPTION'
  | 'CRASH_MEMORY'
  | 'CRASH_FAILFAST'
  | 'CRASH_STACKOVERFLOW';

/**
 * Lifecycle states for a simulation instance.
 *
 * State machine: ACTIVE → COMPLETED (duration elapsed)
 *                ACTIVE → STOPPED   (user-initiated stop)
 *                ACTIVE → FAILED    (error during simulation)
 *
 * Only ACTIVE simulations consume resources. Terminal states are immutable.
 */
export type SimulationStatus = 'ACTIVE' | 'COMPLETED' | 'STOPPED' | 'FAILED';

/**
 * Log severity levels — used in the event log ring buffer.
 * Maps to console.log/warn/error and is sent to the frontend for color-coding.
 */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Types of events that can be logged in the event system.
 *
 * Events are:
 *   1. Written to the in-memory ring buffer (EventLogService)
 *   2. Printed to stdout/stderr for server log visibility
 *   3. Broadcast to all connected WebSocket clients for the dashboard event log
 */
export type EventType =
  | 'SIMULATION_STARTED'
  | 'SIMULATION_STOPPED'
  | 'SIMULATION_COMPLETED'
  | 'SIMULATION_FAILED'
  | 'CRASH_WARNING'
  | 'MEMORY_ALLOCATING'
  | 'MEMORY_ALLOCATED'
  | 'MEMORY_RELEASED'
  | 'SERVER_STARTED'
  | 'CLIENT_CONNECTED'
  | 'CLIENT_DISCONNECTED'
  | 'LOAD_TEST_STATS';

// =============================================================================
// SIMULATION PARAMETER TYPES
// =============================================================================

/**
 * Parameters for CPU stress simulation.
 *
 * BEHAVIOR:
 *   The service spawns N child processes (via fork()) where
 *   N = round((targetLoadPercent / 100) * CPU_CORE_COUNT).
 *   Each child process runs a tight synchronous loop (pbkdf2Sync) burning 100%
 *   of one CPU core. The OS scheduler distributes them across physical cores.
 *
 * PORTING NOTES:
 *   - Java: Use Executors with Runnable tasks in a thread pool.
 *   - Python: Use multiprocessing.Process (not threading — GIL prevents true parallelism).
 *   - PHP: Use pcntl_fork() or parallel processes.
 *   - C#: Use Task.Run with synchronous CPU-bound work.
 *   The key is using OS-level parallelism (processes or threads) to ensure
 *   the load is visible in system-wide CPU metrics.
 */
export interface CpuStressParams {
  /** CPU stress intensity level. 'moderate' targets ~65%, 'high' targets ~100%. */
  intensity: 'moderate' | 'high';
  /** Duration in seconds. After this, worker processes are killed and simulation completes. */
  durationSeconds: number;
}

/**
 * Parameters for memory pressure simulation.
 *
 * BEHAVIOR:
 *   Allocates heap objects (not raw buffers) so the memory shows up in
 *   garbage-collected heap metrics. Each ~4800 small JS objects ≈ 1MB.
 *   Allocation is done asynchronously in batches to avoid blocking I/O.
 *   Memory is held until explicitly released via DELETE endpoint.
 *
 * PORTING NOTES:
 *   - Allocate managed heap objects (not native memory) so the runtime's
 *     memory metrics reflect the allocation.
 *   - In Java: ArrayList<byte[]> or similar; in C#: List<byte[]>.
 *   - In Python: list of dicts or bytearray objects.
 *   - Memory does NOT auto-expire — user must call the release endpoint.
 */
export interface MemoryPressureParams {
  /** Memory to allocate in megabytes. No practical upper limit enforced. */
  sizeMb: number;
}

/**
 * Parameters for event loop blocking simulation.
 *
 * BEHAVIOR:
 *   Blocks the main application thread using synchronous cryptographic operations.
 *   Works in "chunks" — each chunk blocks for chunkMs, then yields briefly via
 *   setImmediate so queued I/O (sidecar probe responses, WebSocket emits) can
 *   flush. This makes the event loop ~97% blocked but allows the dashboard to
 *   show latency spikes in real-time rather than only after the simulation ends.
 *
 * PORTING NOTES:
 *   - This simulates the effect of synchronous/blocking operations on the
 *     main request-processing thread.
 *   - In Java (Servlet): Thread.sleep() or heavy computation on a request thread.
 *   - In Python (asyncio): time.sleep() in the event loop (blocking the loop).
 *   - In PHP: usleep() in the main thread.
 *   - The chunked approach with yields is specific to Node.js's cooperatively-
 *     scheduled event loop. In preemptively threaded runtimes, a single long
 *     blocking call has the same effect.
 */
export interface EventLoopBlockingParams {
  /** Total duration to block in seconds. */
  durationSeconds: number;
  /** Duration of each blocking chunk in ms (default: 200). Between chunks, a brief
   *  yield allows queued I/O (probe responses, IPC messages, Socket.IO emits) to flush
   *  so the latency chart updates in real-time during the block. */
  chunkMs?: number;
}

/**
 * Blocking patterns for slow request simulation.
 *
 * Three patterns demonstrate different ways a request can be "slow":
 *   - setTimeout:  Non-blocking async delay. The server remains fully responsive
 *                  to other requests. Simulates async I/O waits (DB queries, API calls).
 *   - libuv:       Saturates the internal I/O thread pool with synchronous crypto.
 *                  Other operations using the thread pool (file I/O, DNS) are starved.
 *                  In Node.js, the libuv thread pool defaults to 4 threads.
 *   - worker:      Spawns a Worker Thread that blocks with CPU-heavy sync work.
 *                  Similar to blocking a .NET ThreadPool thread.
 *
 * PORTING NOTES:
 *   - setTimeout → async delay (Task.Delay in C#, asyncio.sleep in Python, etc.)
 *   - libuv      → thread pool exhaustion (saturate the runtime's worker threads)
 *   - worker     → dedicated blocking threads (new Thread with blocking work)
 */
export type SlowRequestBlockingPattern = 'setTimeout' | 'libuv' | 'worker';

/**
 * Parameters for slow request simulation.
 */
export interface SlowRequestParams {
  /** Response delay in seconds (1-300) */
  delaySeconds: number;
  /** Blocking pattern to use (default: setTimeout). See SlowRequestBlockingPattern. */
  blockingPattern?: SlowRequestBlockingPattern;
}

/**
 * Discriminated union type for all simulation parameters.
 *
 * The `type` field acts as a discriminator/tag, enabling type-safe handling
 * of different parameter shapes in a single field.
 *
 * PORTING NOTES:
 *   - Java 17+: sealed interface with record implementations.
 *   - C#: abstract record with derived types.
 *   - Python: Union type with Literal discriminator or @dataclass subclasses.
 *   - The key pattern: store a `type` discriminator alongside type-specific fields.
 */
export type SimulationParameters =
  | ({ type: 'CPU_STRESS' } & CpuStressParams)
  | ({ type: 'MEMORY_PRESSURE' } & MemoryPressureParams)
  | ({ type: 'EVENT_LOOP_BLOCKING' } & EventLoopBlockingParams)
  | ({ type: 'SLOW_REQUEST' } & SlowRequestParams)
  | { type: 'CRASH_EXCEPTION' }
  | { type: 'CRASH_MEMORY' };

// =============================================================================
// SIMULATION RECORD
// =============================================================================

/**
 * Represents an active or completed simulation instance.
 *
 * Stored in-memory by SimulationTrackerService in a Map<id, Simulation>.
 * Lifecycle is managed via status transitions (see SimulationStatus).
 * Serialized to JSON in API responses and admin endpoints.
 *
 * PORTING NOTES:
 *   This is the core domain entity. In a production system you might persist
 *   these to a database; here they are in-memory only (lost on restart).
 */
export interface Simulation {
  /** Unique identifier (UUID v4). Generated via crypto.randomUUID(). */
  id: string;
  /** Type of simulation — determines which service handles it. */
  type: SimulationType;
  /** Type-specific configuration (discriminated union keyed on type field). */
  parameters: SimulationParameters;
  /** Current lifecycle state (ACTIVE → terminal state). */
  status: SimulationStatus;
  /** When the simulation started (UTC). */
  startedAt: Date;
  /** When the simulation ended (null if still active). Set on stop/complete/fail. */
  stoppedAt: Date | null;
  /** When the simulation will auto-stop if not manually stopped. */
  scheduledEndAt: Date;
}

// =============================================================================
// SYSTEM METRICS — collected every metricsIntervalMs and broadcast via WebSocket
// =============================================================================

/**
 * CPU usage metrics.
 *
 * COLLECTION METHOD:
 *   Uses system-wide CPU measurement via os.cpus() — captures ALL CPU activity
 *   including child worker processes. Compares idle vs total time between snapshots
 *   to derive percentage. Also includes per-process CPU time breakdown.
 *
 * PORTING NOTES:
 *   - Java: ManagementFactory.getOperatingSystemMXBean().getSystemCpuLoad()
 *   - Python: psutil.cpu_percent()
 *   - C#: PerformanceCounter or System.Diagnostics.Process.TotalProcessorTime
 *   - The key is measuring SYSTEM-WIDE CPU, not just the main process, because
 *     CPU stress uses child processes that wouldn't appear in process-only metrics.
 */
export interface CpuMetrics {
  /** Current CPU usage percentage (0-100), measured system-wide across all cores */
  usagePercent: number;
  /** User CPU time in microseconds (main process only) */
  user: number;
  /** System/kernel CPU time in microseconds (main process only) */
  system: number;
}

/**
 * Memory usage metrics.
 *
 * METRICS EXPLAINED:
 *   - heapUsedMb:    Managed/GC-tracked memory (JS objects). Equivalent to
 *                    Java's used heap or .NET's GC.GetTotalMemory().
 *   - heapTotalMb:   Total heap space allocated by the runtime (may exceed used).
 *   - rssMb:         Resident Set Size — total physical memory footprint of the
 *                    process, including native allocations, code, stacks, and heap.
 *   - externalMb:    Memory allocated by native (C++) bindings outside the GC heap.
 *   - totalSystemMb: Total physical RAM on the host machine.
 *
 * PORTING NOTES:
 *   Map to your runtime's memory introspection APIs:
 *   - Java: Runtime.getRuntime().totalMemory(), maxMemory(), freeMemory()
 *   - Python: psutil.Process().memory_info().rss, tracemalloc for heap
 *   - C#: GC.GetTotalMemory(), Process.WorkingSet64
 */
export interface MemoryMetrics {
  /** V8 heap memory used in MB (managed/GC-tracked objects) */
  heapUsedMb: number;
  /** V8 heap memory allocated in MB (total heap space reserved by runtime) */
  heapTotalMb: number;
  /** Resident Set Size in MB (total physical memory footprint) */
  rssMb: number;
  /** External memory (native C++ objects) in MB */
  externalMb: number;
  /** Total physical system memory in MB */
  totalSystemMb: number;
}

/**
 * Event loop lag metrics — measures how responsive the main thread is.
 *
 * CONCEPT:
 *   In Node.js (and other event-driven runtimes), the "event loop" processes
 *   I/O callbacks, timers, and network events. When the loop is blocked by
 *   synchronous work, new events queue up and experience "lag."
 *
 *   Two complementary measurements are used:
 *   1. lagMs (histogram mean): Uses perf_hooks.monitorEventLoopDelay(), a built-in
 *      Node.js API that samples event loop delay with microsecond precision.
 *   2. heartbeatLagMs: Measures actual wall-clock time for a setImmediate callback
 *      to fire. More intuitive and responsive for the dashboard display.
 *
 * PORTING NOTES:
 *   This concept is specific to event-loop-based runtimes (Node.js, Python asyncio).
 *   - Java: Measure thread pool queue wait time or use Spring Actuator's event loop metrics.
 *   - C#: Measure ThreadPool queue depth or Task scheduling delay.
 *   - Python asyncio: Measure delay between loop iterations.
 *   - PHP (synchronous): Not directly applicable — use request processing time instead.
 */
export interface EventLoopMetrics {
  /** Mean event loop lag in ms (from perf_hooks histogram) */
  lagMs: number;
  /** Real-time heartbeat lag in ms (wall-clock time for setImmediate to fire) */
  heartbeatLagMs: number;
  /** 99th percentile lag in ms */
  lagP99Ms: number;
  /** Minimum observed lag in ms */
  minMs: number;
  /** Maximum observed lag in ms */
  maxMs: number;
}

/**
 * Process-level metrics.
 *
 * activeHandles/activeRequests are Node.js-specific (libuv internals).
 * In other runtimes, track equivalent resource counts (open connections,
 * pending async operations, thread pool utilization).
 */
export interface ProcessMetrics {
  /** Process ID — used by the dashboard to detect application restarts */
  pid: number;
  /** Number of active handles (sockets, timers, etc.) — Node.js/libuv specific */
  activeHandles: number;
  /** Number of active libuv I/O requests — Node.js specific */
  activeRequests: number;
  /** Process uptime in seconds */
  uptime: number;
}

/**
 * Complete system metrics snapshot.
 *
 * Collected at a configurable interval (default 250ms) by MetricsService and
 * broadcast to all WebSocket clients. The frontend dashboard uses these to
 * update real-time charts and numeric displays.
 *
 * PORTING NOTES:
 *   This is the payload shape for the 'metrics' WebSocket event.
 *   All fields are serialized to JSON with timestamp as ISO 8601 string.
 */
export interface SystemMetrics {
  /** When these metrics were collected (serialized as ISO 8601 string in JSON) */
  timestamp: Date;
  /** CPU usage metrics */
  cpu: CpuMetrics;
  /** Memory usage metrics */
  memory: MemoryMetrics;
  /** Event loop / main thread responsiveness metrics */
  eventLoop: EventLoopMetrics;
  /** Process-level metrics */
  process: ProcessMetrics;
}

// =============================================================================
// EVENT LOG — in-memory ring buffer of application events
// =============================================================================

/**
 * An entry in the event log.
 *
 * The event log is a bounded ring buffer (default 100 entries) that records
 * simulation lifecycle events and system events. Each entry is:
 *   1. Stored in the ring buffer (newest pushes oldest out)
 *   2. Printed to console (stdout/stderr based on level)
 *   3. Broadcast to WebSocket clients as an 'event' message
 *
 * PORTING NOTES:
 *   Implement as a circular buffer / bounded queue. In Java: ArrayDeque with
 *   size cap; in Python: collections.deque(maxlen=N); in C#: Queue with trim.
 */
export interface EventLogEntry {
  /** Unique identifier (UUID) */
  id: string;
  /** When the event occurred */
  timestamp: Date;
  /** Severity level */
  level: LogLevel;
  /** Associated simulation ID (if applicable) */
  simulationId: string | null;
  /** Type of simulation (if applicable) */
  simulationType: SimulationType | null;
  /** What happened */
  event: EventType;
  /** Human-readable description */
  message: string;
  /** Additional structured data */
  details: Record<string, unknown> | null;
}

// =============================================================================
// APPLICATION CONFIGURATION
// =============================================================================

/**
 * Application configuration.
 *
 * All values are loaded from environment variables at startup with sensible
 * defaults. Azure App Service sets PORT automatically.
 *
 * PORTING NOTES:
 *   Use your framework's configuration system (Spring application.properties,
 *   Django settings.py, Laravel .env, etc.). All values should be overridable
 *   via environment variables for containerized/cloud deployments.
 */
export interface AppConfig {
  /** HTTP server port */
  port: number;
  /** Metrics collection/broadcast interval in ms */
  metricsIntervalMs: number;
  /** Maximum simulation duration in seconds */
  maxSimulationDurationSeconds: number;
  /** Maximum single memory allocation in MB */
  maxMemoryAllocationMb: number;
  /** Maximum event log entries to retain */
  eventLogMaxEntries: number;
}

// =============================================================================
// API RESPONSE TYPES — standardized JSON response shapes
// =============================================================================

/**
 * API error response structure.
 *
 * All error responses from the application follow this shape for consistency.
 * The global error handler middleware transforms exceptions into this format.
 *
 * PORTING NOTES:
 *   Implement a global exception handler (Spring @ControllerAdvice,
 *   Django middleware, Laravel exception handler) that converts all
 *   exceptions to this JSON shape with appropriate HTTP status codes.
 */
export interface ApiError {
  /** Error type/code */
  error: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details (optional) */
  details?: Record<string, unknown>;
}

/**
 * Standard API success response for simulation operations.
 */
export interface SimulationResponse {
  /** Simulation ID */
  id: string;
  /** Simulation type */
  type: SimulationType;
  /** Status message */
  message: string;
}

// =============================================================================
// LOAD TEST TYPES — for Azure Load Testing integration
// =============================================================================

/**
 * Request parameters for load test endpoint.
 *
 * This endpoint is designed to be hit by Azure Load Testing (or similar tools)
 * with many concurrent requests. All properties have sensible defaults so
 * query parameters are optional.
 *
 * ALGORITHM OVERVIEW:
 *   The load test endpoint simulates realistic application behavior that
 *   degrades gracefully under load:
 *   1. Allocates memory (split 50/50 between managed heap and native buffers)
 *   2. Calculates response delay based on concurrency: baselineDelayMs + max(0, concurrent - softLimit) * degradationFactor
 *   3. Interleaves CPU work with brief async sleeps in a loop until total delay elapsed
 *   4. After 120s elapsed, has a 20% chance per cycle of throwing a random exception
 *   5. Returns timing diagnostics in the response
 *
 * PORTING NOTES:
 *   The concurrency counter is safe as a simple integer because Node.js is
 *   single-threaded. In multi-threaded runtimes, use atomic counters or
 *   thread-safe types (AtomicInteger in Java, Interlocked in C#).
 */
export interface LoadTestRequest {
  /** CPU work intensity (workIterations / 100 = ms of spin per cycle). Default: 200 */
  workIterations: number;
  /** Memory buffer held for request duration in KB. Default: 20000 */
  bufferSizeKb: number;
  /** Minimum request duration in ms. Default: 500 */
  baselineDelayMs: number;
  /** Concurrent requests before degradation begins. Default: 25 */
  softLimit: number;
  /** Additional delay (ms) per request over soft limit. Default: 500 */
  degradationFactor: number;
}

/**
 * Result returned from load test endpoint with timing and diagnostic information.
 *
 * This response is designed to give load testing tools detailed insights into
 * how the request was processed, enabling analysis of degradation patterns.
 */
export interface LoadTestResult {
  /** Total elapsed time for the request in milliseconds */
  elapsedMs: number;
  /** Number of concurrent requests when this request started processing */
  concurrentRequestsAtStart: number;
  /** Milliseconds of artificial delay applied due to exceeding soft limit */
  degradationDelayAppliedMs: number;
  /** Total ms of CPU work completed (0 if exception thrown before completion) */
  workIterationsCompleted: number;
  /** Bytes of memory allocated (0 if exception thrown before allocation) */
  memoryAllocatedBytes: number;
  /** Whether the request completed all work successfully */
  workCompleted: boolean;
  /** Whether an exception was thrown during processing */
  exceptionThrown: boolean;
  /** Type name of exception thrown (null if no exception) */
  exceptionType: string | null;
  /** UTC timestamp when the result was generated */
  timestamp: string;
}

/**
 * Current statistics for the load test service.
 */
export interface LoadTestStats {
  /** Number of requests currently being processed */
  currentConcurrentRequests: number;
  /** Total requests processed since app start */
  totalRequestsProcessed: number;
  /** Total random exceptions thrown (after 120s timeout) */
  totalExceptionsThrown: number;
  /** Average response time in milliseconds */
  averageResponseTimeMs: number;
}

/**
 * Load test statistics data broadcast via WebSocket every 60 seconds.
 *
 * These periodic stats are broadcast to the dashboard and also written to
 * the event log. Stats are reset after each broadcast (period-based reporting).
 */
export interface LoadTestStatsData {
  /** Current number of concurrent requests being processed */
  currentConcurrent: number;
  /** Peak concurrent requests observed in this reporting period */
  peakConcurrent: number;
  /** Total requests completed in this reporting period */
  requestsCompleted: number;
  /** Average response time in ms for this period */
  avgResponseTimeMs: number;
  /** Maximum response time observed in this period */
  maxResponseTimeMs: number;
  /** Requests per second throughput */
  requestsPerSecond: number;
  /** Number of exceptions thrown in this period */
  exceptionCount: number;
  /** When this stats snapshot was taken */
  timestamp: string;
}

// =============================================================================
// HEALTH & ADMIN RESPONSE TYPES
// =============================================================================

/**
 * Health check response structure.
 *
 * Used by Azure App Service health probes and monitoring tools.
 * The /api/health endpoint returns this shape.
 */
export interface HealthResponse {
  /** Service status */
  status: 'healthy';
  /** Response timestamp */
  timestamp: string;
  /** Process uptime in seconds */
  uptime: number;
  /** Application version */
  version: string;
}

/**
 * Admin status response structure.
 *
 * Comprehensive status overview returned by GET /api/admin/status.
 * Includes configuration, active simulations, and current metrics.
 */
export interface AdminStatusResponse {
  /** Service status */
  status: 'healthy';
  /** Response timestamp */
  timestamp: string;
  /** Process uptime in seconds */
  uptime: number;
  /** Application version */
  version: string;
  /** Current configuration */
  config: AppConfig;
  /** Active simulations */
  activeSimulations: Simulation[];
  /** Count of active simulations */
  simulationCount: number;
}
