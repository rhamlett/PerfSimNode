/**
 * =============================================================================
 * SIMULATION CONTEXT SERVICE — Application Insights Telemetry Correlation
 * =============================================================================
 *
 * PURPOSE:
 *   Sets simulation context on OpenTelemetry spans, enabling users to filter
 *   and correlate telemetry by simulation ID using KQL queries in App Insights.
 *
 * HOW IT WORKS:
 *   1. When a simulation starts, sets SimulationId and SimulationType as span attributes
 *   2. These attributes flow to Application Insights as customDimensions
 *   3. Users can filter traces, requests, and dependencies by simulation ID
 *
 * APPLICATION INSIGHTS INTEGRATION:
 *   - Uses OpenTelemetry span attributes (via @azure/monitor-opentelemetry)
 *   - Attributes appear in customDimensions on traces and requests tables
 *   - Works transparently — if App Insights is not configured, calls are no-ops
 *
 * KQL QUERY EXAMPLES:
 *   // Find all requests for a specific simulation
 *   requests
 *   | where customDimensions.SimulationId == "abc123-def4-..."
 *   | order by timestamp desc
 *
 *   // Find all CPU stress simulation traces
 *   traces
 *   | where customDimensions.SimulationType == "CPU_STRESS"
 *   | order by timestamp desc
 *
 *   // Find dependencies triggered during a simulation
 *   dependencies
 *   | where customDimensions.SimulationId == "abc123-def4-..."
 *   | order by timestamp desc
 *
 * PORTING NOTES:
 *   - .NET: Use Activity.Current?.SetTag() or TelemetryClient
 *   - Java: Use OpenTelemetry Span.setAttribute()
 *   - Python: Use opentelemetry span.set_attribute()
 *
 * @module services/simulation-context
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';

/**
 * Simulation context information.
 */
export interface SimulationContextInfo {
  simulationId: string;
  simulationType: string;
}

/**
 * Service for tracking simulation context and correlating with Application Insights.
 *
 * This service provides methods to:
 * - Set simulation context on the current OpenTelemetry span
 * - Enable filtering of App Insights telemetry by simulation ID
 */
class SimulationContextServiceClass {
  /**
   * Sets the simulation context on the current OpenTelemetry span.
   *
   * This adds SimulationId and SimulationType as span attributes, which flow
   * to Application Insights as customDimensions for KQL filtering on traces.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation (e.g., 'CPU_STRESS', 'MEMORY_PRESSURE')
   */
  setContext(simulationId: string, simulationType: string): void {
    try {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        activeSpan.setAttribute('SimulationId', simulationId);
        activeSpan.setAttribute('SimulationType', simulationType);
      }
    } catch (error) {
      // Silent fail - telemetry is optional
      console.debug('[SimulationContext] Failed to set span attributes:', error);
    }
  }

  /**
   * Tracks a simulation ended event by setting attributes on the current span.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation
   */
  trackSimulationEnded(simulationId: string, simulationType: string): void {
    try {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        activeSpan.setAttribute('SimulationEnded', true);
        activeSpan.setAttribute('SimulationId', simulationId);
        activeSpan.setAttribute('SimulationType', simulationType);
      }
    } catch (error) {
      console.debug('[SimulationContext] Failed to track simulation ended:', error);
    }
  }

  /**
   * Tracks a simulation start event with a cleanup function for the end event.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation
   * @returns A function to call when the simulation ends
   */
  trackSimulationStart(simulationId: string, simulationType: string): () => void {
    // Start an OpenTelemetry span for trace correlation
    let span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']> | null = null;
    try {
      const tracer = trace.getTracer('perfsimnode');
      span = tracer.startSpan(`simulation:${simulationType}`, {
        attributes: {
          'SimulationId': simulationId,
          'SimulationType': simulationType,
        },
      });
    } catch (error) {
      console.debug('[SimulationContext] Failed to start span:', error);
    }

    // Return cleanup function
    return () => {
      if (span) {
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      }
    };
  }

  /**
   * Creates a wrapper that sets simulation context for async operations.
   *
   * @param simulationId - Simulation ID
   * @param simulationType - Type of simulation
   * @param fn - Async function to wrap
   * @returns Result of the wrapped function
   */
  async withContext<T>(
    simulationId: string,
    simulationType: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const endTracking = this.trackSimulationStart(simulationId, simulationType);

    try {
      const result = await fn();
      return result;
    } finally {
      endTracking();
    }
  }
}

// Singleton instance
export const SimulationContextService = new SimulationContextServiceClass();
