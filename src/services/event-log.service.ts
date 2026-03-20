/**
 * =============================================================================
 * EVENT LOG SERVICE — Application Event Ring Buffer & Broadcasting
 * =============================================================================
 *
 * PURPOSE:
 *   Central logging service for simulation lifecycle events and system events.
 *   Maintains a bounded in-memory ring buffer and broadcasts each new event
 *   to connected WebSocket clients for real-time dashboard updates.
 *
 * DATA FLOW:
 *   Service/Controller calls EventLogService.info/warn/error()
 *     → Entry added to in-memory array
 *     → Entry printed to console (stdout/stderr based on level)
 *     → Entry broadcast to all WebSocket clients via broadcaster callback
 *
 * SINGLETON PATTERN:
 *   Single instance created at module load. All services share it.
 *
 * MEMORY:
 *   Event log grows unbounded during runtime but clears when the process
 *   restarts. This is acceptable since the dashboard clears on page refresh
 *   and long-running sessions are not expected in this educational tool.
 *
 * PORTING NOTES:
 *   - Java: Use ArrayList or ConcurrentLinkedDeque. Thread-safe wrapper
 *     needed if accessed from multiple threads.
 *   - Python: Simple list — no maxlen needed.
 *   - C#: List<T> or ConcurrentQueue<T>.
 *   - PHP: Simple array.
 *
 *   The broadcaster callback pattern decouples this service from Socket.IO.
 *   The main server wires it up at startup: EventLogService.setBroadcaster(fn).
 *   In other frameworks, use an event bus or observer pattern.
 *
 * @module services/event-log
 */

import { EventLogEntry, EventType, LogLevel, SimulationType } from '../types';
import { generateId } from '../utils';

/**
 * Service for logging simulation and system events.
 *
 * Maintains an in-memory array of events that clears on process restart.
 */
class EventLogServiceClass {
  private entries: EventLogEntry[] = [];
  private broadcaster: ((event: EventLogEntry) => void) | null = null;

  constructor() {
    // No configuration needed - unlimited entries
  }

  /**
   * Sets a broadcaster function to emit events in real-time (e.g., via Socket.IO).
   * @param fn - Function to call with each new event
   */
  setBroadcaster(fn: (event: EventLogEntry) => void): void {
    this.broadcaster = fn;
  }
  /**
   * Logs a new event.
   *
   * @param event - Event type
   * @param message - Human-readable message
   * @param options - Additional options
   * @returns The created log entry
   */
  log(
    event: EventType,
    message: string,
    options: {
      level?: LogLevel;
      simulationId?: string;
      simulationType?: SimulationType;
      details?: Record<string, unknown>;
    } = {}
  ): EventLogEntry {
    const entry: EventLogEntry = {
      id: generateId(),
      timestamp: new Date(),
      level: options.level ?? 'info',
      simulationId: options.simulationId ?? null,
      simulationType: options.simulationType ?? null,
      event,
      message,
      details: options.details ?? null,
    };

    this.entries.push(entry);

    // Also log to console for visibility
    const consoleMessage = `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] ${event}: ${message}`;
    if (entry.level === 'error') {
      console.error(consoleMessage);
    } else if (entry.level === 'warn') {
      console.warn(consoleMessage);
    } else {
      console.log(consoleMessage);
    }

    // Broadcast to connected clients if broadcaster is set
    if (this.broadcaster) {
      this.broadcaster(entry);
    }

    return entry;
  }

  /**
   * Logs an info-level event.
   *
   * @param event - Event type
   * @param message - Human-readable message
   * @param options - Additional options
   * @returns The created log entry
   */
  info(
    event: EventType,
    message: string,
    options?: {
      simulationId?: string;
      simulationType?: SimulationType;
      details?: Record<string, unknown>;
    }
  ): EventLogEntry {
    return this.log(event, message, { ...options, level: 'info' });
  }

  /**
   * Logs a warning-level event.
   *
   * @param event - Event type
   * @param message - Human-readable message
   * @param options - Additional options
   * @returns The created log entry
   */
  warn(
    event: EventType,
    message: string,
    options?: {
      simulationId?: string;
      simulationType?: SimulationType;
      details?: Record<string, unknown>;
    }
  ): EventLogEntry {
    return this.log(event, message, { ...options, level: 'warn' });
  }

  /**
   * Logs an error-level event.
   *
   * @param event - Event type
   * @param message - Human-readable message
   * @param options - Additional options
   * @returns The created log entry
   */
  error(
    event: EventType,
    message: string,
    options?: {
      simulationId?: string;
      simulationType?: SimulationType;
      details?: Record<string, unknown>;
    }
  ): EventLogEntry {
    return this.log(event, message, { ...options, level: 'error' });
  }

  /**
   * Gets all log entries.
   *
   * @returns Array of all log entries (newest last)
   */
  getEntries(): EventLogEntry[] {
    return [...this.entries];
  }

  /**
   * Gets the most recent log entries.
   *
   * @param limit - Maximum number of entries to return
   * @returns Array of recent log entries (newest first)
   */
  getRecentEntries(limit: number = 50): EventLogEntry[] {
    const entries = [...this.entries].reverse();
    return entries.slice(0, limit);
  }

  /**
   * Gets log entries for a specific simulation.
   *
   * @param simulationId - Simulation ID to filter by
   * @returns Array of log entries for the simulation
   */
  getEntriesForSimulation(simulationId: string): EventLogEntry[] {
    return this.entries.filter((entry) => entry.simulationId === simulationId);
  }

  /**
   * Gets log entries by level.
   *
   * @param level - Log level to filter by
   * @returns Array of log entries at the specified level
   */
  getEntriesByLevel(level: LogLevel): EventLogEntry[] {
    return this.entries.filter((entry) => entry.level === level);
  }

  /**
   * Gets the count of log entries.
   *
   * @returns Number of entries in the log
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Clears all log entries.
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Singleton instance of the EventLogService.
 */
export const EventLogService = new EventLogServiceClass();
