/**
 * =============================================================================
 * SIMULATION CONTEXT SERVICE — Application Insights Telemetry Correlation
 * =============================================================================
 *
 * PURPOSE:
 *   Tracks the current simulation context and correlates it with Azure Application
 *   Insights telemetry via OpenTelemetry Activity (span) tags. This enables users
 *   to filter Application Insights logs and traces by simulation ID.
 *
 * HOW IT WORKS:
 *   1. When a simulation starts, set tags on the current OpenTelemetry span
 *   2. Tags flow automatically to Application Insights as custom dimensions
 *   3. Users can query: customDimensions["SimulationId"] == "abc-123"
 *
 * APPLICATION INSIGHTS INTEGRATION:
 *   - Uses OpenTelemetry API to access the current span (Activity in .NET terms)
 *   - Sets SimulationId and SimulationType as span attributes
 *   - Attributes appear as customDimensions in App Insights queries
 *   - Works transparently — if App Insights is not configured, tags are simply ignored
 *
 * KQL QUERY EXAMPLES:
 *   // Find all traces for a specific simulation
 *   traces
 *   | where customDimensions["SimulationId"] == "abc123-def4-..."
 *   | order by timestamp desc
 *
 *   // Find all CPU stress simulations
 *   traces
 *   | where customDimensions["SimulationType"] == "CPU_STRESS"
 *   | order by timestamp desc
 *
 * PORTING NOTES:
 *   - .NET: Use System.Diagnostics.Activity.Current?.SetTag()
 *   - Java: Use OpenTelemetry Span.current().setAttribute()
 *   - Python: Use opentelemetry.trace.get_current_span().set_attribute()
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
 * - Track simulation start/end events as custom metrics
 * - Enable filtering of App Insights telemetry by simulation ID
 */
class SimulationContextServiceClass {
  /**
   * Sets the simulation context on the current OpenTelemetry span.
   *
   * This adds SimulationId and SimulationType as span attributes, which flow
   * to Application Insights as customDimensions for KQL filtering.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation (e.g., 'CPU_STRESS', 'MEMORY_PRESSURE')
   */
  setContext(simulationId: string, simulationType: string): void {
    try {
      // Get the active span from OpenTelemetry context
      const activeSpan = trace.getActiveSpan();
      
      if (activeSpan) {
        // Set attributes that will flow to Application Insights as customDimensions
        activeSpan.setAttribute('SimulationId', simulationId);
        activeSpan.setAttribute('SimulationType', simulationType);
        
        // Also add to the span name for better visibility in traces
        activeSpan.updateName(`simulation:${simulationType}:${simulationId.substring(0, 8)}`);
      }
    } catch (error) {
      // Silent fail - telemetry is optional
      console.debug('[SimulationContext] Failed to set span attributes:', error);
    }
  }

  /**
   * Tracks a simulation start event.
   *
   * Creates a new span for the simulation and sets context attributes.
   * Returns a function to end the span when the simulation completes.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation
   * @returns A function to call when the simulation ends
   */
  trackSimulationStart(simulationId: string, simulationType: string): () => void {
    try {
      const tracer = trace.getTracer('perfsimnode');
      
      // Start a new span for the simulation
      const span = tracer.startSpan(`simulation:${simulationType}`, {
        attributes: {
          'SimulationId': simulationId,
          'SimulationType': simulationType,
          'simulation.event': 'started',
        },
      });

      // Return a cleanup function
      return () => {
        span.setAttribute('simulation.event', 'ended');
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
      };
    } catch (error) {
      // Silent fail - telemetry is optional
      console.debug('[SimulationContext] Failed to track simulation start:', error);
      return () => {}; // No-op cleanup function
    }
  }

  /**
   * Tracks a simulation event (e.g., progress update, error).
   *
   * @param simulationId - Simulation ID
   * @param simulationType - Type of simulation
   * @param eventName - Name of the event
   * @param attributes - Additional attributes to include
   */
  trackEvent(
    simulationId: string,
    simulationType: string,
    eventName: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    try {
      const activeSpan = trace.getActiveSpan();
      
      if (activeSpan) {
        activeSpan.addEvent(eventName, {
          'SimulationId': simulationId,
          'SimulationType': simulationType,
          ...attributes,
        });
      }
    } catch (error) {
      // Silent fail - telemetry is optional
      console.debug('[SimulationContext] Failed to track event:', error);
    }
  }

  /**
   * Creates a wrapper that sets simulation context for async operations.
   *
   * Use this when you need to ensure simulation context flows across async boundaries.
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
    const tracer = trace.getTracer('perfsimnode');
    
    return tracer.startActiveSpan(`simulation:${simulationType}`, async (span) => {
      try {
        span.setAttribute('SimulationId', simulationId);
        span.setAttribute('SimulationType', simulationType);
        
        const result = await fn();
        
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}

// Singleton instance
export const SimulationContextService = new SimulationContextServiceClass();
