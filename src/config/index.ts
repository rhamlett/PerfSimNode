/**
 * =============================================================================
 * APPLICATION CONFIGURATION
 * =============================================================================
 *
 * PURPOSE:
 *   Centralizes all configurable values in one place. Every tunable parameter
 *   (port, intervals, limits) is defined here with sensible defaults that can
 *   be overridden via environment variables.
 *
 * ARCHITECTURE ROLE:
 *   Imported by services, middleware, and controllers that need access to
 *   configuration values. Acts as the single source of truth for all tunable
 *   parameters, avoiding magic numbers scattered throughout the codebase.
 *
 * ENVIRONMENT VARIABLES:
 *   - PORT                          → HTTP server port (Azure App Service sets this)
 *   - METRICS_INTERVAL_MS           → How often metrics are collected/broadcast (ms)
 *   - MAX_SIMULATION_DURATION_SECONDS → Upper limit for timed simulations
 *   - MAX_MEMORY_ALLOCATION_MB      → Upper limit for single memory allocation
 *   - EVENT_LOG_MAX_ENTRIES         → Ring buffer size for event log
 *
 * PORTING NOTES:
 *   - Java Spring: Use application.properties/yml with @Value or @ConfigurationProperties.
 *   - Python Django: Use settings.py with os.environ.get().
 *   - PHP Laravel: Use .env file with config() helper.
 *   - C# ASP.NET: Use appsettings.json with IConfiguration.
 *   Every runtime has a standard config mechanism — use it, don't hardcode values.
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
 *
 * All config values use a parse-with-fallback pattern:
 * if the env var is set and parseable → use it; otherwise → use the default.
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
 *
 * Used by controllers when optional request parameters are omitted.
 * These provide a good out-of-box experience for demo/training scenarios.
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
 *
 * Used by the validation middleware to enforce bounds on user input.
 * Min/max ranges prevent accidental resource exhaustion from invalid input.
 *
 * PORTING NOTES:
 *   Define these as constants and reference them in your validation layer.
 *   In Java, use Spring's @Min/@Max annotations; in Python, Pydantic Field(ge=, le=).
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
