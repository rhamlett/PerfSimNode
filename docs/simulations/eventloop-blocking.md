# Event Loop Blocking Simulation Guide

## Overview

This simulation demonstrates a critical Node.js anti-pattern: blocking the event loop with synchronous operations. Understanding this helps engineers identify and diagnose blocked event loop scenarios.

## Educational Features

The dashboard provides real-time visualization of event loop blocking impact:

### 1. Server Responsiveness Indicator
- **Green dot + "Responsive"**: Server is healthy
- **Red pulsing dot + "UNRESPONSIVE"**: Server is blocked
- Shows duration of unresponsiveness in real-time

### 2. Probe Visualization
- Shows last 20 heartbeat probes (100ms intervals normally)
- **Green dots**: Successful probes (< 150ms)
- **Orange dots**: Degraded probes (150ms - 1s)
- **Red dots**: Failed/timed out probes

> **Note**: During Slow Request simulations, probe frequency is automatically reduced to 
> 5000ms (1 probe every 5 seconds) to avoid noise in Node.js profiling diagnostics
> (V8 CPU Profiler, Application Insights). A message is displayed during this time.

### 3. Impact Analysis
After blocking completes, shows:
- Actual server block duration
- Average latency of queued concurrent requests
- Total round-trip time

### 4. Real-Time Latency Chart
Tracks actual probe response times, showing spikes during and after blocking.

## How It Works

Node.js runs JavaScript in a single thread with an event loop. When synchronous (blocking) operations run, the event loop cannot process other events:

1. Request arrives to block event loop
2. Synchronous crypto operations execute
3. **All other requests queue up**
4. Response sent after blocking completes
5. Queued requests then process

## API Usage

### Block Event Loop

```bash
POST /api/simulations/eventloop
Content-Type: application/json

{
  "durationSeconds": 5
}
```

**Parameters:**
- `durationSeconds` (1-60): Duration to block in seconds

**Response (after blocking completes):**
```json
{
  "id": "uuid-of-simulation",
  "type": "EVENT_LOOP_BLOCKING",
  "message": "Event loop was blocked for 5s",
  "actualDurationMs": 5023
}
```

## ⚠️ Warning

During event loop blocking:
- Server is **completely unresponsive**
- All requests timeout or queue
- WebSocket heartbeats fail
- Health checks fail
- Dashboard updates stop

## Diagnostic Exercises

### Exercise 1: Watch the Dashboard

1. Open dashboard in browser
2. Note the green "Responsive" indicator and probe dots
3. Click "Block Event Loop" for 5 seconds
4. **Watch the probe dots turn red**
5. **See the indicator change to "UNRESPONSIVE"**
6. Observe everything resume after blocking
7. Check the Impact Analysis results

### Exercise 2: Concurrent Request Impact

```bash
# Terminal 1: Block event loop
curl -X POST localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 10}'

# Terminal 2: Immediately try health check
time curl localhost:3000/api/health
# Notice it takes ~10 seconds to respond
```

### Exercise 3: Event Loop Lag Metrics

1. Note baseline event loop lag (usually < 10ms)
2. Run blocking simulation
3. After completion, check event loop metrics
4. Observe max lag value increased

## Expected Observations

| Metric | During Block | After Block |
|--------|--------------|-------------|
| CPU | High (single core) | Normal |
| Memory | No change | No change |
| Event Loop Lag | Cannot measure (blocked) | Shows max spike |
| Requests | All queued | Process queued requests |
| WebSocket | Disconnects may occur | Reconnects |

## Real-World Causes

Event loop blocking in production is usually caused by:

1. **Synchronous file operations**
   ```javascript
   // Bad
   const data = fs.readFileSync(bigFile);
   
   // Good
   const data = await fs.promises.readFile(bigFile);
   ```

2. **CPU-intensive computations**
   ```javascript
   // Bad (blocks)
   const result = expensiveComputation(data);
   
   // Better (use worker threads)
   const result = await workerPool.exec(expensiveComputation, [data]);
   ```

3. **Synchronous crypto**
   ```javascript
   // Bad
   const hash = crypto.pbkdf2Sync(...);
   
   // Good
   const hash = await crypto.pbkdf2(...);
   ```

4. **Large JSON parsing**
   ```javascript
   // Can block on very large JSON
   const data = JSON.parse(hugeJsonString);
   ```

## Detection Tools

### perf_hooks

```javascript
const { monitorEventLoopDelay } = require('perf_hooks');

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

setInterval(() => {
  console.log('Event loop lag:', h.mean / 1e6, 'ms');
}, 1000);
```

### Clinic.js

```bash
# Install
npm install -g clinic

# Run doctor analysis
clinic doctor -- node dist/index.js
# Trigger workload, then Ctrl+C
# Opens report in browser
```

## Prevention

1. **Use async APIs** - Prefer `async/await` over sync methods
2. **Offload to workers** - Use worker threads for CPU tasks
3. **Chunk large operations** - Break up large loops with `setImmediate`
4. **Set timeouts** - Detect blocking with lag monitoring
5. **Load test** - Test under realistic concurrency
