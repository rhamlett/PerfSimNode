/**
 * =============================================================================
 * APPLICATION INSIGHTS INSTRUMENTATION — Application Performance Monitoring
 * =============================================================================
 *
 * PURPOSE:
 *   Initializes Azure Application Insights SDK for automatic request tracking,
 *   dependency tracking, exception tracking, and custom events.
 *
 * CRITICAL REQUIREMENT:
 *   This module MUST be imported BEFORE any other application code. The SDK
 *   needs to monkey-patch HTTP and other modules before they are loaded.
 *
 * HOW IT WORKS:
 *   - Checks for APPLICATIONINSIGHTS_CONNECTION_STRING environment variable
 *   - If present (Azure App Service sets this automatically): enables full telemetry
 *   - If absent (local development): silently disables — app runs without APM
 *   - Auto-instruments: HTTP requests, Express routes, dependencies, exceptions
 *
 * CUSTOM EVENTS:
 *   The SDK provides trackEvent() for custom events that appear in the
 *   customEvents / AppEvents table in Log Analytics. This is used by
 *   SimulationContextService to track SimulationStarted/SimulationEnded events.
 *
 * PORTING NOTES:
 *   - Java: Use applicationinsights-agent or TelemetryClient
 *   - Python: Use applicationinsights SDK
 *   - C#: Use Microsoft.ApplicationInsights SDK
 *
 * @module instrumentation
 */

import appInsights from 'applicationinsights';

// Check if we should enable Application Insights
const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  try {
    console.log('[PerfSimNode] Initializing Application Insights SDK...');
    appInsights.setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(false)
      .setUseDiskRetryCaching(true)
      .setSendLiveMetrics(false)
      .start();
    console.log('[PerfSimNode] Application Insights SDK initialized');
  } catch (error) {
    console.error('[PerfSimNode] Failed to initialize Application Insights SDK:', error);
  }
} else {
  console.log('[PerfSimNode] APPLICATIONINSIGHTS_CONNECTION_STRING not set - Application Insights disabled');
}

// Export the client for use by other modules
export const appInsightsClient = appInsights.defaultClient;
