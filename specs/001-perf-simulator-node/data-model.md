# Data Model: Performance Problem Simulator

**Feature**: 001-perf-simulator-node  
**Date**: 2026-02-08  
**Purpose**: Define entities, interfaces, and data structures for implementation

## Overview

This application operates entirely in-memory with no persistent storage. All data
structures are runtime state that resets when the process restarts. This aligns with
the spec requirement that simulation history need not persist across restarts.

---

## Core Entities

### Simulation

Represents an active or completed simulation instance.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier for this simulation instance |
| type | SimulationType | Category of performance problem being simulated |
| parameters | SimulationParameters | Configuration specific to the simulation type |
| status | SimulationStatus | Current state of the simulation |
| startedAt | Date | Timestamp when simulation began |
| stoppedAt | Date \| null | Timestamp when simulation ended (null if still active) |
| scheduledEndAt | Date | Timestamp when simulation will auto-stop if not manually stopped |

**State Transitions**:
```
[created] → active → completed
                  → stopped (manually)
                  → failed (error occurred)
```

---

### SimulationType

Enumeration of available simulation categories.

| Value | Description |
|-------|-------------|
| CPU_STRESS | High CPU utilization via computation |
| MEMORY_PRESSURE | Allocated memory that is retained |
| EVENT_LOOP_BLOCKING | Synchronous operation blocking the event loop |
| SLOW_REQUEST | HTTP response with artificial delay |
| CRASH_EXCEPTION | Unhandled exception causing process termination |
| CRASH_MEMORY | Memory exhaustion causing OOM termination |

---

### SimulationParameters

Type-specific configuration values. Uses a discriminated union pattern.

| Type | Parameters |
|------|------------|
| CPU_STRESS | targetLoadPercent: number (1-100), durationSeconds: number (1-300) |
| MEMORY_PRESSURE | sizeMb: number (1-1000) |
| EVENT_LOOP_BLOCKING | durationSeconds: number (1-300) |
| SLOW_REQUEST | delaySeconds: number (1-300) |
| CRASH_EXCEPTION | (no parameters) |
| CRASH_MEMORY | (no parameters) |

---

### SimulationStatus

Enumeration of simulation lifecycle states.

| Value | Description |
|-------|-------------|
| ACTIVE | Simulation is currently running |
| COMPLETED | Simulation finished normally (duration elapsed) |
| STOPPED | Simulation was manually stopped before completion |
| FAILED | Simulation encountered an error |

---

### SystemMetrics

Current system state measurements collected at regular intervals.

| Field | Type | Description |
|-------|------|-------------|
| timestamp | Date | When these metrics were collected |
| cpu | CpuMetrics | CPU usage information |
| memory | MemoryMetrics | Memory usage information |
| eventLoop | EventLoopMetrics | Event loop lag information |
| process | ProcessMetrics | Process-level information |

---

### CpuMetrics

| Field | Type | Description |
|-------|------|-------------|
| usagePercent | number | Current CPU usage percentage (0-100) |
| user | number | User CPU time in microseconds (since last sample) |
| system | number | System CPU time in microseconds (since last sample) |

---

### MemoryMetrics

| Field | Type | Description |
|-------|------|-------------|
| heapUsedMb | number | V8 heap memory used in megabytes |
| heapTotalMb | number | V8 heap memory allocated in megabytes |
| rssMb | number | Resident Set Size in megabytes |
| externalMb | number | Memory used by C++ objects bound to JS |

---

### EventLoopMetrics

| Field | Type | Description |
|-------|------|-------------|
| lagMs | number | Current event loop lag in milliseconds |
| lagP99Ms | number | 99th percentile lag in milliseconds |
| minMs | number | Minimum observed lag since last reset |
| maxMs | number | Maximum observed lag since last reset |

---

### ProcessMetrics

| Field | Type | Description |
|-------|------|-------------|
| activeHandles | number | Number of active handles (sockets, timers, etc.) |
| activeRequests | number | Number of active libuv requests |
| uptime | number | Process uptime in seconds |

---

### EventLogEntry

A timestamped record of simulation activity.

| Field | Type | Description |
|-------|------|-------------|
| id | string (UUID) | Unique identifier for this log entry |
| timestamp | Date | When the event occurred |
| level | LogLevel | Severity level (info, warn, error) |
| simulationId | string \| null | Associated simulation ID if applicable |
| simulationType | SimulationType \| null | Type of simulation if applicable |
| event | EventType | What happened |
| message | string | Human-readable description |
| details | Record<string, unknown> \| null | Additional structured data |

---

### EventType

| Value | Description |
|-------|-------------|
| SIMULATION_STARTED | A simulation was triggered |
| SIMULATION_STOPPED | A simulation was manually stopped |
| SIMULATION_COMPLETED | A simulation finished its duration |
| SIMULATION_FAILED | A simulation encountered an error |
| MEMORY_ALLOCATED | Memory was allocated (memory pressure) |
| MEMORY_RELEASED | Memory was released |
| SERVER_STARTED | Application started |
| CLIENT_CONNECTED | WebSocket client connected |
| CLIENT_DISCONNECTED | WebSocket client disconnected |

---

### Configuration

Application settings (loaded from environment or defaults).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| port | number | 3000 | HTTP server port |
| metricsIntervalMs | number | 1000 | How often to collect/broadcast metrics |
| maxSimulationDurationSeconds | number | 300 | Maximum allowed simulation duration |
| maxMemoryAllocationMb | number | 500 | Maximum single memory allocation size |
| eventLogMaxEntries | number | 100 | Maximum entries to retain in event log |

---

## TypeScript Interfaces

```typescript
/**
 * Types of performance simulations available in the system.
 */
export type SimulationType =
  | 'CPU_STRESS'
  | 'MEMORY_PRESSURE'
  | 'EVENT_LOOP_BLOCKING'
  | 'SLOW_REQUEST'
  | 'CRASH_EXCEPTION'
  | 'CRASH_MEMORY';

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
  | { type: 'CPU_STRESS' } & CpuStressParams
  | { type: 'MEMORY_PRESSURE' } & MemoryPressureParams
  | { type: 'EVENT_LOOP_BLOCKING' } & EventLoopBlockingParams
  | { type: 'SLOW_REQUEST' } & SlowRequestParams
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
}

/**
 * Event loop lag metrics.
 */
export interface EventLoopMetrics {
  /** Current event loop lag in ms */
  lagMs: number;
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
```

---

## Entity Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                        Runtime State                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐        ┌───────────────────┐                 │
│  │ Configuration│        │ SimulationTracker │                 │
│  │  (singleton) │        │   (singleton)     │                 │
│  └──────────────┘        └─────────┬─────────┘                 │
│                                    │                            │
│                          tracks    │  manages                   │
│                                    ▼                            │
│                          ┌─────────────────┐                   │
│                          │   Simulation[]  │◄──── 0..many      │
│                          │                 │      active       │
│                          └─────────────────┘                   │
│                                    │                            │
│                          logs      │                            │
│                                    ▼                            │
│                          ┌─────────────────┐                   │
│                          │ EventLogEntry[] │◄──── circular     │
│                          │   (ring buffer) │      buffer       │
│                          └─────────────────┘                   │
│                                                                 │
│  ┌──────────────────┐                                          │
│  │ MetricsCollector │──── samples ────► SystemMetrics          │
│  │   (singleton)    │                   (current snapshot)     │
│  └──────────────────┘                                          │
│                                                                 │
│  ┌──────────────────┐                                          │
│  │MemoryAllocations │◄──── Map<id, Buffer>                     │
│  │   (singleton)    │      for explicit release                │
│  └──────────────────┘                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Validation Rules

| Entity | Field | Validation |
|--------|-------|------------|
| CpuStressParams | targetLoadPercent | 1 ≤ value ≤ 100, integer |
| CpuStressParams | durationSeconds | 1 ≤ value ≤ 300, integer |
| MemoryPressureParams | sizeMb | 1 ≤ value ≤ config.maxMemoryAllocationMb, integer |
| EventLoopBlockingParams | durationSeconds | 1 ≤ value ≤ 300, integer |
| SlowRequestParams | delaySeconds | 1 ≤ value ≤ 300, integer |
