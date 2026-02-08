# Slow Requests Simulation Guide

## Overview

The slow request simulation adds an artificial delay to HTTP responses. Unlike event loop blocking, this uses asynchronous delays, so other requests can still be processed.

## How It Works

The simulation uses `setTimeout()` to delay the response:

1. Request arrives
2. Server acknowledges internally
3. Waits asynchronously for the specified duration
4. Sends response after delay
5. **Other requests are NOT affected**

## API Usage

### Send Slow Request

```bash
GET /api/simulations/slow?delaySeconds=10
```

**Parameters:**
- `delaySeconds` (1-300): Delay in seconds (default: 5)

**Response (after delay):**
```json
{
  "id": "uuid-of-simulation",
  "type": "SLOW_REQUEST",
  "message": "Response delayed by 10s",
  "requestedDelaySeconds": 10,
  "actualDurationMs": 10002
}
```

## Key Difference from Event Loop Blocking

| Aspect | Slow Request | Event Loop Block |
|--------|--------------|------------------|
| Other requests | Process normally | Queue up |
| Dashboard | Continues updating | Freezes |
| Health checks | Pass | Fail |
| CPU usage | Normal | High |
| Implementation | setTimeout (async) | Sync loop |

## Diagnostic Exercises

### Exercise 1: Concurrent Slow Requests

```bash
# Start multiple slow requests simultaneously
curl "localhost:3000/api/simulations/slow?delaySeconds=10" &
curl "localhost:3000/api/simulations/slow?delaySeconds=10" &
curl "localhost:3000/api/simulations/slow?delaySeconds=10" &

# Health check still works
curl localhost:3000/api/health
# Returns immediately!
```

### Exercise 2: Timeout Testing

Configure client timeout lower than delay:

```bash
# This will timeout before response
curl --max-time 5 "localhost:3000/api/simulations/slow?delaySeconds=10"
# curl: (28) Operation timed out
```

### Exercise 3: Azure Request Tracing

1. Deploy to Azure App Service
2. Enable Application Insights
3. Make slow requests
4. View in Application Insights → Performance
5. Analyze request duration distribution

## Real-World Causes

Slow requests in production typically result from:

1. **Slow database queries**
   ```javascript
   // Slow due to missing index
   await db.query('SELECT * FROM orders WHERE user_email = ?', [email]);
   ```

2. **External API calls**
   ```javascript
   // Third-party API is slow
   const data = await fetch('https://slow-api.example.com/data');
   ```

3. **File I/O**
   ```javascript
   // Large file processing
   const contents = await fs.promises.readFile('/large/file.json');
   ```

4. **Complex computations** (when done async)
   ```javascript
   // CPU-bound but not blocking
   await complexImageProcessing(image);
   ```

## Detection and Monitoring

### Request Duration Tracking

```javascript
// Middleware to track request duration
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 5000) {
      console.warn(`Slow request: ${req.method} ${req.url} took ${duration}ms`);
    }
  });
  next();
});
```

### Application Insights

```javascript
// Custom tracking
const appInsights = require('applicationinsights');

// Track dependency call
const duration = Date.now();
try {
  await externalApiCall();
} finally {
  appInsights.defaultClient.trackDependency({
    name: 'ExternalAPI',
    duration: Date.now() - duration,
    success: true
  });
}
```

## Best Practices

1. **Set appropriate timeouts** - Don't wait forever for external calls
2. **Add circuit breakers** - Fail fast when dependencies are slow
3. **Cache when possible** - Reduce repeated slow operations
4. **Use queues for long operations** - Don't block the request/response cycle
5. **Monitor SLOs** - Track p50, p95, p99 response times
