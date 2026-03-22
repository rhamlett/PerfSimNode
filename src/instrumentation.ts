/**
 * =============================================================================
 * APPLICATION INSIGHTS INSTRUMENTATION — Application Performance Monitoring
 * =============================================================================
 *
 * PURPOSE:
 *   Initializes Azure Application Insights SDK for automatic request tracking,
 *   dependency tracking, exception tracking, and custom events.
 *
 * CRITICAL: This module is designed to NEVER crash the application, even if
 * Application Insights fails to initialize. All errors are caught and logged.
 *
 * @module instrumentation
 */

let appInsightsClient: import('applicationinsights').TelemetryClient | null = null;

// Defer initialization to avoid crashing during module load
function initializeAppInsights(): void {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  
  if (!connectionString) {
    console.log('[PerfSimNode] APPLICATIONINSIGHTS_CONNECTION_STRING not set - Application Insights disabled');
    return;
  }

  try {
    // Dynamic import to avoid issues if the module has problems
    const appInsights = require('applicationinsights');
    
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
    
    appInsightsClient = appInsights.defaultClient;
    console.log('[PerfSimNode] Application Insights SDK initialized');
  } catch (error) {
    console.error('[PerfSimNode] Failed to initialize Application Insights SDK:', error);
    console.log('[PerfSimNode] Continuing without Application Insights');
    appInsightsClient = null;
  }
}

// Initialize on first import - but safely
try {
  initializeAppInsights();
} catch (error) {
  console.error('[PerfSimNode] Unexpected error during App Insights init:', error);
}

// Export getter function for the client
export function getAppInsightsClient(): import('applicationinsights').TelemetryClient | null {
  return appInsightsClient;
}
