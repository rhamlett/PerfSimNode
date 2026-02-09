/**
 * TypeScript Types and Interfaces
 *
 * Defines all data structures used throughout the application.
 *
 * @module types
 */

/**
 * Types of performance simulations available in the system.
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
 */
export type SimulationStatus = 'ACTIVE' | 'COMPLETED' | 'STOPPED' | 'FAILED';

/**
 * Log severity levels.
 */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Types of events that can be logged.
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
  | 'CLIENT_DISCONNECTED';

/**
 * Parameters for CPU stress simulation.
 */
export interface CpuStressParams {
  /** Target CPU load percentage (1-100) */
  targetLoadPercent: number;
  /** Duration in seconds (1-300) */
  durationSeconds: number;
}

/**
 * Parameters for memory pressure simulation.
 */
export interface MemoryPressureParams {
  /** Memory to allocate in megabytes (1-1000) */
  sizeMb: number;
}

/**
 * Parameters for event loop blocking simulation.
 */
export interface EventLoopBlockingParams {
  /** Duration to block in seconds (1-300) */
  durationSeconds: number;
}

/**
 * Parameters for slow request simulation.
 */
export interface SlowRequestParams {
  /** Response delay in seconds (1-300) */
  delaySeconds: number;
}

/**
 * Union type for all simulation parameters.
 */
export type SimulationParameters =
  | ({ type: 'CPU_STRESS' } & CpuStressParams)
  | ({ type: 'MEMORY_PRESSURE' } & MemoryPressureParams)
  | ({ type: 'EVENT_LOOP_BLOCKING' } & EventLoopBlockingParams)
  | ({ type: 'SLOW_REQUEST' } & SlowRequestParams)
  | { type: 'CRASH_EXCEPTION' }
  | { type: 'CRASH_MEMORY' };

/**
 * Represents an active or completed simulation instance.
 */
export interface Simulation {
  /** Unique identifier (UUID) */
  id: string;
  /** Type of simulation */
  type: SimulationType;
  /** Type-specific configuration */
  parameters: SimulationParameters;
  /** Current lifecycle state */
  status: SimulationStatus;
  /** When the simulation started */
  startedAt: Date;
  /** When the simulation ended (null if still active) */
  stoppedAt: Date | null;
  /** When the simulation will auto-stop */
  scheduledEndAt: Date;
}

/**
 * CPU usage metrics.
 */
export interface CpuMetrics {
  /** Current CPU usage percentage (0-100) */
  usagePercent: number;
  /** User CPU time in microseconds */
  user: number;
  /** System CPU time in microseconds */
  system: number;
}

/**
 * Memory usage metrics.
 */
export interface MemoryMetrics {
  /** V8 heap memory used in MB */
  heapUsedMb: number;
  /** V8 heap memory allocated in MB */
  heapTotalMb: number;
  /** Resident Set Size in MB */
  rssMb: number;
  /** External memory (C++ objects) in MB */
  externalMb: number;
  /** Total system memory in MB */
  totalSystemMb: number;
}

/**
 * Event loop lag metrics.
 */
export interface EventLoopMetrics {
  /** Current event loop lag in ms (from histogram mean) */
  lagMs: number;
  /** Real-time heartbeat lag in ms (actual time for setImmediate to fire) */
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
 */
export interface ProcessMetrics {
  /** Process ID */
  pid: number;
  /** Number of active handles (sockets, timers, etc.) */
  activeHandles: number;
  /** Number of active libuv requests */
  activeRequests: number;
  /** Process uptime in seconds */
  uptime: number;
}

/**
 * Complete system metrics snapshot.
 */
export interface SystemMetrics {
  /** When these metrics were collected */
  timestamp: Date;
  /** CPU usage metrics */
  cpu: CpuMetrics;
  /** Memory usage metrics */
  memory: MemoryMetrics;
  /** Event loop metrics */
  eventLoop: EventLoopMetrics;
  /** Process metrics */
  process: ProcessMetrics;
}

/**
 * An entry in the event log.
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

/**
 * Application configuration.
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

/**
 * API error response structure.
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

/**
 * Health check response structure.
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
