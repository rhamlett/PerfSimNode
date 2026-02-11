/**
 * Application Configuration Module
 *
 * Centralizes configuration management with environment variable support.
 *
 * @module config
 */

import { AppConfig } from '../types';

/**
 * Parses an integer from environment variable with fallback.
 *
 * @param envVar - Environment variable name
 * @param defaultValue - Default value if env var is not set
 * @returns Parsed integer or default value
 */
function parseIntEnv(envVar: string, defaultValue: number): number {
  const value = process.env[envVar];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Application configuration loaded from environment variables with defaults.
 */
export const config: AppConfig = {
  /** HTTP server port (default: 3000, or PORT env var for Azure App Service) */
  port: parseIntEnv('PORT', 3000),

  /** Metrics collection/broadcast interval in milliseconds */
  metricsIntervalMs: parseIntEnv('METRICS_INTERVAL_MS', 250),

  /** Maximum allowed simulation duration in seconds (no practical limit) */
  maxSimulationDurationSeconds: parseIntEnv('MAX_SIMULATION_DURATION_SECONDS', 86400),

  /** Maximum single memory allocation in megabytes (no practical limit) */
  maxMemoryAllocationMb: parseIntEnv('MAX_MEMORY_ALLOCATION_MB', 65536),

  /** Maximum number of event log entries to retain (ring buffer) */
  eventLogMaxEntries: parseIntEnv('EVENT_LOG_MAX_ENTRIES', 100),
};

/**
 * Application version from package.json.
 */
export const APP_VERSION = '1.0.0';

/**
 * Application name.
 */
export const APP_NAME = 'PerfSimNode';

/**
 * Default values for simulation parameters.
 */
export const defaults = {
  /** Default CPU stress target load percentage */
  cpuTargetLoadPercent: 50,
  /** Default CPU stress duration in seconds */
  cpuDurationSeconds: 30,
  /** Default memory allocation size in MB */
  memorySizeMb: 100,
  /** Default event loop blocking duration in seconds */
  eventLoopDurationSeconds: 5,
  /** Default slow request delay in seconds */
  slowRequestDelaySeconds: 5,
};

/**
 * Validation limits for simulation parameters.
 */
export const limits = {
  /** Minimum CPU load percentage */
  minCpuLoadPercent: 1,
  /** Maximum CPU load percentage */
  maxCpuLoadPercent: 100,
  /** Minimum duration for timed simulations (seconds) */
  minDurationSeconds: 1,
  /** Maximum duration for timed simulations (seconds) */
  maxDurationSeconds: config.maxSimulationDurationSeconds,
  /** Minimum memory allocation (MB) */
  minMemoryMb: 1,
  /** Maximum memory allocation (MB) */
  maxMemoryMb: config.maxMemoryAllocationMb,
};
