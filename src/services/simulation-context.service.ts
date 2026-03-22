/**
 * =============================================================================
 * SIMULATION CONTEXT SERVICE — Application Insights Telemetry Correlation
 * =============================================================================
 *
 * PURPOSE:
 *   Tracks simulation lifecycle events in Azure Application Insights, enabling
 *   users to filter and correlate telemetry by simulation ID using KQL queries.
 *
 * HOW IT WORKS:
 *   1. When a simulation starts, tracks a "SimulationStarted" custom event
 *   2. When a simulation ends, tracks a "SimulationEnded" custom event
 *   3. Both events include SimulationId and SimulationType as properties
 *   4. Also sets OpenTelemetry span attributes for trace correlation
 *
 * APPLICATION INSIGHTS INTEGRATION:
 *   - Uses the applicationinsights SDK's trackEvent() for custom events
 *   - Custom events appear in the customEvents table in Log Analytics
 *   - Properties appear in customDimensions for KQL filtering
 *   - Works transparently — if App Insights is not configured, calls are no-ops
 *
 * KQL QUERY EXAMPLES:
 *   // Find all simulation events
 *   customEvents
 *   | where name in ("SimulationStarted", "SimulationEnded")
 *   | project timestamp, name, customDimensions.SimulationId, customDimensions.SimulationType
 *
 *   // Find all events for a specific simulation
 *   customEvents
 *   | where customDimensions.SimulationId == "abc123-def4-..."
 *   | order by timestamp desc
 *
 *   // Find all CPU stress simulations
 *   customEvents
 *   | where customDimensions.SimulationType == "CPU_STRESS"
 *   | order by timestamp desc
 *
 * PORTING NOTES:
 *   - .NET: Use TelemetryClient.TrackEvent()
 *   - Java: Use TelemetryClient.trackEvent()
 *   - Python: Use azure.monitor.opentelemetry or applicationinsights SDK
 *
 * @module services/simulation-context
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import appInsights from 'applicationinsights';

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
 * - Track simulation start/end as custom events in App Insights
 * - Set simulation context on the current OpenTelemetry span
 * - Enable filtering of App Insights telemetry by simulation ID
 */
class SimulationContextServiceClass {
  private client: appInsights.TelemetryClient | null = null;
  private initialized = false;

  /**
   * Initializes the Application Insights SDK for custom event tracking.
   * This is separate from the OpenTelemetry auto-instrumentation in instrumentation.ts.
   * Called lazily on first use.
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (!connectionString) {
      console.log('[SimulationContext] APPLICATIONINSIGHTS_CONNECTION_STRING not set - custom events disabled');
      return;
    }

    try {
      // Initialize the classic Application Insights SDK for custom event tracking
      // This is separate from the @azure/monitor-opentelemetry SDK used for auto-instrumentation
      console.log('[SimulationContext] Initializing Application Insights SDK for custom events...');
      
      appInsights.setup(connectionString)
        .setAutoCollectRequests(false)  // Disable - OpenTelemetry handles this
        .setAutoCollectPerformance(false, false)
        .setAutoCollectExceptions(false)
        .setAutoCollectDependencies(false)
        .setAutoCollectConsole(false)
        .setUseDiskRetryCaching(true)
        .setSendLiveMetrics(false)
        .start();
      
      this.client = appInsights.defaultClient;
      
      if (this.client) {
        console.log('[SimulationContext] Application Insights SDK initialized successfully');
      } else {
        console.error('[SimulationContext] Failed to get Application Insights client after setup');
      }
    } catch (error) {
      console.error('[SimulationContext] Failed to initialize Application Insights SDK:', error);
    }
  }

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
    this.ensureInitialized();

    // Track the SimulationStarted custom event
    this.trackCustomEvent('SimulationStarted', simulationId, simulationType);

    // Also set OpenTelemetry span attributes for trace correlation
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
   * Tracks a simulation ended event.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation
   */
  trackSimulationEnded(simulationId: string, simulationType: string): void {
    this.trackCustomEvent('SimulationEnded', simulationId, simulationType);
  }

  /**
   * Tracks a custom event in Application Insights.
   *
   * @param eventName - Name of the event (e.g., 'SimulationStarted', 'SimulationEnded')
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation
   * @param additionalProperties - Optional additional properties to include
   */
  private trackCustomEvent(
    eventName: string,
    simulationId: string,
    simulationType: string,
    additionalProperties?: Record<string, string>
  ): void {
    if (!this.client) {
      console.log(`[SimulationContext] No client available - skipping ${eventName} event for ${simulationType}`);
      return;
    }

    try {
      this.client.trackEvent({
        name: eventName,
        properties: {
          SimulationId: simulationId,
          SimulationType: simulationType,
          ...additionalProperties,
        },
      });

      // Flush immediately to ensure event is sent (don't wait for batching)
      this.client.flush();

      console.log(`[SimulationContext] Tracked and flushed ${eventName} for ${simulationType} (${simulationId.substring(0, 8)}...)`);
    } catch (error) {
      console.error(`[SimulationContext] Failed to track ${eventName}:`, error);
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
    this.ensureInitialized();
    this.trackCustomEvent('SimulationStarted', simulationId, simulationType);

    // Also start an OpenTelemetry span for trace correlation
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
      this.trackCustomEvent('SimulationEnded', simulationId, simulationType);
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
