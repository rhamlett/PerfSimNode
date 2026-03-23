/**
 * =============================================================================
 * SIMULATION CONTEXT SERVICE — Application Insights Custom Events
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
 *
 * APPLICATION INSIGHTS INTEGRATION:
 *   - Uses the applicationinsights SDK's trackEvent() for custom events
 *   - Custom events appear in the customEvents / AppEvents table in Log Analytics
 *   - Properties appear in customDimensions for KQL filtering
 *   - Works transparently — if App Insights is not configured, calls are no-ops
 *
 * KQL QUERY EXAMPLES:
 *   // Find all simulation events (Log Analytics)
 *   AppEvents
 *   | where Name in ("SimulationStarted", "SimulationEnded")
 *   | project TimeGenerated, Name, Properties.SimulationId, Properties.SimulationType
 *
 *   // Find all events for a specific simulation
 *   AppEvents
 *   | where Properties.SimulationId == "abc123-def4-..."
 *   | order by TimeGenerated desc
 *
 *   // Alternative query using customEvents table
 *   customEvents
 *   | where name in ("SimulationStarted", "SimulationEnded")
 *   | project timestamp, name, customDimensions.SimulationId, customDimensions.SimulationType
 *
 * PORTING NOTES:
 *   - .NET: Use TelemetryClient.TrackEvent()
 *   - Java: Use TelemetryClient.trackEvent()
 *   - Python: Use applicationinsights SDK
 *
 * @module services/simulation-context
 */

import { getAppInsightsClient } from '../instrumentation';

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
 * - Enable filtering of App Insights telemetry by simulation ID
 */
class SimulationContextServiceClass {
  /**
   * Sets the simulation context by tracking a SimulationStarted event.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation (e.g., 'CPU_STRESS', 'MEMORY_PRESSURE')
   */
  setContext(simulationId: string, simulationType: string): void {
    this.trackCustomEvent('SimulationStarted', simulationId, simulationType);
  }

  /**
   * Sets the simulation context and waits for the flush to complete.
   * Use this for simulations that block the event loop or cause heavy resource usage,
   * which might prevent the async flush from completing.
   *
   * @param simulationId - Unique identifier for the simulation
   * @param simulationType - Type of simulation
   */
  async setContextAsync(simulationId: string, simulationType: string): Promise<void> {
    await this.trackCustomEventAsync('SimulationStarted', simulationId, simulationType);
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
   */
  private trackCustomEvent(
    eventName: string,
    simulationId: string,
    simulationType: string
  ): void {
    try {
      const client = getAppInsightsClient();
      if (!client) {
        console.log(`[SimulationContext] No App Insights client for ${eventName} (${simulationType})`);
        return;
      }

      console.log(`[SimulationContext] Tracking ${eventName} for ${simulationType} (${simulationId})`);

      client.trackEvent({
        name: eventName,
        properties: {
          SimulationId: simulationId,
          SimulationType: simulationType,
        },
      });
      client.flush();
      
      console.log(`[SimulationContext] Queued flush for ${eventName} (${simulationType})`);
    } catch (error) {
      // Silent fail - telemetry should never break the app
      console.debug(`[SimulationContext] Failed to track ${eventName}:`, error);
    }
  }

  /**
   * Tracks a custom event and waits for flush to complete.
   * Use for operations that will block the event loop.
   */
  private async trackCustomEventAsync(
    eventName: string,
    simulationId: string,
    simulationType: string
  ): Promise<void> {
    try {
      const client = getAppInsightsClient();
      if (!client) {
        console.log(`[SimulationContext] No App Insights client for ${eventName} (${simulationType})`);
        return;
      }

      console.log(`[SimulationContext] Tracking ${eventName} for ${simulationType} (${simulationId})`);
      console.log(`[SimulationContext] Client endpoint: ${client.config?.endpointUrl}`);
      
      client.trackEvent({
        name: eventName,
        properties: {
          SimulationId: simulationId,
          SimulationType: simulationType,
        },
      });

      // Wait for flush with a timeout to ensure data is sent before blocking operations
      await new Promise<void>((resolve) => {
        client.flush({
          callback: (response) => {
            console.log(`[SimulationContext] Flush response for ${eventName}: ${response}`);
            resolve();
          }
        });
        // Fallback timeout in case callback doesn't fire
        setTimeout(resolve, 2000);
      });
      
      console.log(`[SimulationContext] Flushed ${eventName} for ${simulationType}`);
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
    this.trackCustomEvent('SimulationStarted', simulationId, simulationType);

    return () => {
      this.trackCustomEvent('SimulationEnded', simulationId, simulationType);
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
