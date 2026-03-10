# Failed Requests Simulation

Generate HTTP 5xx server errors for testing error monitoring, alerting, and Azure AppLens diagnostics.

## Overview

The Failed Requests simulation makes internal HTTP requests that are guaranteed to fail with 500 status codes. Each request performs real work (CPU stress, memory allocation, artificial delay) before throwing a randomly selected exception, creating realistic error signatures visible in monitoring tools.

## Purpose

Use this simulation to:
- Train Azure AppLens error diagnostics (HTTP Server Errors detector)
- Test Application Insights failure tracking and error grouping
- Verify error alerting and notification systems
- Practice interpreting diverse error types in production monitoring

## How It Works

1. **Request Initiation**: Dashboard triggers POST to `/api/simulations/failed`
2. **Load Test Backend**: Service calls `/api/loadtest` internally with:
   - `errorAboveConcurrent: -1` (always inject errors)
   - `errorPercent: 100` (100% error probability)
3. **Work Simulation**: Each request performs CPU iterations, memory allocation, and 500ms delay
4. **Error Injection**: Random exception selected from pool of 17 error types
5. **HTTP 500 Response**: Error returned with stack trace and error type in response body

## API Reference

### Endpoint

```
POST /api/simulations/failed
Content-Type: application/json
```

### Parameters

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| requestCount | number | 5 | 1-50 | Number of HTTP 5xx errors to generate |

### Example Request

```bash
curl -X POST http://localhost:3000/api/simulations/failed \
  -H "Content-Type: application/json" \
  -d '{"requestCount": 10}'
```

### Example Response

```json
{
  "message": "Failed request simulation completed",
  "totalRequests": 10,
  "results": [
    { "status": 500, "errorType": "TimeoutError" },
    { "status": 500, "errorType": "InvalidOperationError" },
    { "status": 500, "errorType": "DatabaseConnectionError" }
  ]
}
```

## Error Types

The simulation randomly selects from these exception types:

| Error Type | Description |
|------------|-------------|
| InvalidOperationError | Invalid operation attempted |
| TypeError | Type mismatch or null reference |
| TimeoutError | Operation exceeded time limit |
| OutOfMemoryError | Memory allocation failure |
| ResourceExhaustionError | System resources depleted |
| NetworkError | Network communication failure |
| DatabaseConnectionError | Unable to connect to database |
| AuthenticationError | Authentication failure |
| AuthorizationError | Insufficient permissions |
| ValidationError | Input validation failure |
| ConfigurationError | Configuration problem |
| SerializationError | Data serialization failure |
| CacheError | Cache operation failure |
| QueueOverflowError | Message queue overflow |
| RateLimitExceededError | Rate limit throttling |
| ServiceUnavailableError | Backend service unavailable |
| InternalServerError | Generic server failure |

## Observing in Azure

### AppLens

Navigate to **Diagnose and solve problems** → **Application Performance** → **HTTP Server Errors**

- View 5xx error rate spike during simulation
- Examine error distribution by type
- Analyze request volume and timing

### Application Insights

Navigate to **Failures** blade:

- **Operations** tab: See failed requests grouped by operation
- **Exceptions** tab: View exception types and stack traces
- **Dependencies** tab: Trace failed internal calls

### Event Log

The dashboard Event Log displays each error with:
- ❌ (red X) icon for failed requests
- Error type in the log message
- Timestamp for correlation with Azure metrics

## Dashboard Usage

1. Find the **Failed Requests** panel (brown color scheme)
2. Enter desired request count (1-50)
3. Click **Generate Failed Requests**
4. Watch the Event Log for ❌ entries showing each error type
5. Review simulation summary showing total errors and types generated

## Integration with Load Testing

The Failed Requests simulation reuses the load test infrastructure:

```
POST /api/simulations/failed
    └── calls → POST /api/loadtest (internal)
                    └── errorAboveConcurrent: -1
                    └── errorPercent: 100
                    └── throws random exception
```

This ensures errors are indistinguishable from real application failures in monitoring tools.
