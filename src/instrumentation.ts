/**
 * =============================================================================
 * OPENTELEMETRY INSTRUMENTATION — Application Performance Monitoring
 * =============================================================================
 *
 * PURPOSE:
 *   Initializes Azure Monitor OpenTelemetry SDK for automatic distributed tracing,
 *   metrics collection, and log correlation in Azure Application Insights.
 *
 * CRITICAL REQUIREMENT:
 *   This module MUST be imported BEFORE any other application code. OpenTelemetry
 *   needs to monkey-patch HTTP, Express, and other modules before they are loaded
 *   to automatically instrument them. If imported after, traces won't be captured.
 *
 * HOW IT WORKS:
 *   - Checks for APPLICATIONINSIGHTS_CONNECTION_STRING environment variable
 *   - If present (Azure App Service sets this automatically): enables full telemetry
 *   - If absent (local development): silently disables — app runs without APM
 *   - Auto-instruments: HTTP requests, Express routes, dependencies
 *
 * PORTING NOTES:
 *   Every cloud platform has an equivalent APM SDK:
 *   - Java: Azure Monitor OpenTelemetry (applicationinsights-agent) or Spring Boot Actuator
 *   - Python: azure-monitor-opentelemetry or opentelemetry-sdk
 *   - C#: Azure.Monitor.OpenTelemetry.AspNetCore or Application Insights SDK
 *   - PHP: OpenTelemetry PHP SDK with Azure Monitor exporter
 *
 *   The pattern is always:
 *   1. Import/initialize the SDK at the very start of the application
 *   2. Configure via connection string (from environment variable)
 *   3. Auto-instrumentation handles most tracing — no code changes needed
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
