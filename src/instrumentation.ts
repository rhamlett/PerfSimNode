/**
 * OpenTelemetry Instrumentation
 *
 * This module initializes Azure Monitor OpenTelemetry for Application Insights.
 * It MUST be loaded before any other application code to ensure proper instrumentation.
 *
 * @module instrumentation
 */

import { useAzureMonitor, AzureMonitorOpenTelemetryOptions } from '@azure/monitor-opentelemetry';

// Configure Azure Monitor OpenTelemetry
const options: AzureMonitorOpenTelemetryOptions = {
  azureMonitorExporterOptions: {
    // Connection string is read from APPLICATIONINSIGHTS_CONNECTION_STRING env var by default
    // Can be set explicitly here for local development:
    // connectionString: 'InstrumentationKey=...'
  },
  instrumentationOptions: {
    // Enable all auto-instrumentation
    http: { enabled: true },
  },
};

// Check if we should enable Application Insights
// Only enable if connection string is available (in Azure or explicitly set)
const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  console.log('[PerfSimNode] Initializing Azure Monitor OpenTelemetry...');
  useAzureMonitor(options);
  console.log('[PerfSimNode] Azure Monitor OpenTelemetry initialized');
} else {
  console.log('[PerfSimNode] APPLICATIONINSIGHTS_CONNECTION_STRING not set - Application Insights disabled');
}

// Re-export for potential future use
export { options as azureMonitorOptions };
