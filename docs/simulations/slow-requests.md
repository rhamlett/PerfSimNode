# Slow Request Simulation

Simulates slow HTTP responses to practice diagnosing latency issues that don't involve CPU or event loop blocking.

## How It Works

Uses `setTimeout()` to delay the HTTP response:

```javascript
// Simplified implementation
app.get('/api/simulations/slow', async (req, res) => {
  const delaySeconds = parseInt(req.query.delaySeconds) || 10;
  
  await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
  
  res.json({ message: 'Slow response completed', delay: delaySeconds });
});
```

**Key characteristic:** The server remains fully responsive to other requests. This contrasts with event loop blocking.

## Dashboard Controls

| Control | Range | Description |
|---------|-------|-------------|
| Delay (seconds) | 1-300 | How long each request takes |
| Interval (seconds) | 1-60 | Time between automated requests |
| Max Requests | 1-100 | Total requests to send |

### Button Actions

- **Start Slow Requests** - Begins sending requests at configured interval
- **Stop** - Cancels remaining requests (in-flight requests complete normally)

### Automated vs Manual

**Dashboard automation:**
- Sends multiple requests over time
- Shows progress (completed/total)
- Useful for sustained slow request simulation

**Manual (API/curl):**
- Single request at a time
- Direct control over timing

## Expected Effects

### Metrics

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| Event Loop Lag | **No change** | setTimeout doesn't block |
| CPU | Minimal | No compute work |
| Memory | Minimal | Just holding request context |
| Request Latency (to slow endpoint) | Equals delay | By design |
| Request Latency (to probe) | **No change** | Other requests unaffected |

### Key Insight

This is the **critical difference** from event loop blocking:

| Request Type | Event Loop Block | Slow Request |
|--------------|------------------|--------------|
| Slow endpoint | Blocked | Takes configured delay |
| Health probe | Blocked | **Normal latency** |
| Metrics websocket | Disconnects | **Continues normally** |
| Dashboard | Freezes | **Updates normally** |

### Dashboard Behavior

- Probe dots remain green (probes succeed)
- Event loop lag stays low
- Charts continue updating
- Event log shows slow request progress
- **Probe frequency reduces to 2500ms** during simulation (for cleaner V8 profiler data)

## Real-World Scenarios

Slow requests in production typically indicate:

### External Dependencies
```javascript
// Slow database query
const results = await db.query('SELECT * FROM huge_table');

// Slow third-party API
const response = await fetch('https://slow-api.example.com/data');
```

### Resource Contention
```javascript
// Waiting for connection pool
const connection = await pool.getConnection();  // May wait if pool exhausted
```

### Distributed Transactions
```javascript
// Multi-service coordination
await Promise.all([
  serviceA.commit(),
  serviceB.commit(),
  serviceC.commit()  // Slowest service determines total time
]);
```

### File System Operations
```javascript
// Large file operations (async but still slow)
await fs.promises.readFile('10gb-file.dat');
```

## Diagnostic Workflow

### 1. Baseline

Verify normal latency before starting:
- Probe dots are green
- Current latency: ~10-50ms

### 2. Start Slow Request Simulation

Via dashboard:
1. Set delay to 30 seconds
2. Set interval to 5 seconds  
3. Set max requests to 5
4. Click "Start Slow Requests"

Or via API:
```bash
curl "http://localhost:3000/api/simulations/slow?delaySeconds=30"
```

### 3. Observe During Simulation

**Dashboard:**
- Probe latency STILL low (green dots)
- Event loop lag STILL near zero
- Slow request progress shown

**Concurrent requests:**
```bash
# This returns immediately, proving server isn't blocked
time curl http://localhost:3000/api/health
# real: 0.05s (not 30s!)

# The slow endpoint does take 30s
time curl "http://localhost:3000/api/simulations/slow?delaySeconds=30"
# real: 30.05s
```

### 4. Compare with Event Loop Blocking

Run the same test with event loop blocking:
```bash
curl -X POST http://localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 10}'
```

Notice:
- Health check **also** takes 10 seconds
- Dashboard **freezes**
- Probe dots turn **red**

## API Reference

### Slow Request

```http
GET /api/simulations/slow?delaySeconds=10
```

**Response:** (Arrives after delay)
```json
{
  "id": "slow_abc123",
  "type": "SLOW_REQUEST",
  "status": "COMPLETED",
  "delaySeconds": 10,
  "actualDelayMs": 10003,
  "timestamp": "2026-02-10T20:00:10.000Z"
}
```

## Azure Diagnostics

### Identifying Slow Requests in Production

**Application Insights:**
```kusto
// Find slow requests by endpoint
requests
| where timestamp > ago(1h)
| summarize 
    count(),
    avg(duration),
    percentile(duration, 95),
    percentile(duration, 99)
by name
| order by percentile_duration_99 desc

// Dependency analysis - find slow external calls
dependencies
| where timestamp > ago(1h)
| where duration > 5000  // > 5 seconds
| summarize count() by target, name
| order by count_ desc
```

### Troubleshooting Pattern

1. **Identify:** Which endpoints are slow?
2. **Correlate:** Are external dependencies slow?
3. **Check:** Connection pool exhaustion?
4. **Verify:** Is it isolated (slow request) or global (event loop block)?

### Key Question: Isolated or Global?

| Symptom | Isolated (Slow Request) | Global (Event Loop Block) |
|---------|-------------------------|---------------------------|
| Health probes | Normal | Fail |
| Other endpoints | Normal latency | Same high latency |
| Multiple instances | Only some affected | All affected simultaneously |

## Probe Frequency Note

During slow request testing, probe frequency automatically changes:

| Mode | Interval | Reason |
|------|----------|--------|
| Normal | 250ms | Real-time dashboard updates |
| During slow requests | 2500ms | Reduces noise for V8 profiler/Application Insights |

The dashboard shows a yellow banner: *"Latency probes reduced during Slow Request testing..."*

This helps when capturing CPU profiles or Application Insights data - fewer probe requests means cleaner diagnostic data focused on the actual application workload.

## Troubleshooting

### Requests complete faster than configured delay

1. Request was aborted/cancelled
2. Check server logs for errors
3. Verify delay parameter is being read correctly

### Dashboard shows high latency during slow requests

This might indicate:
1. You're measuring the slow endpoint itself (expected)
2. System under actual load (not just simulation)
3. Bug in measuring - probe endpoint should be unaffected

### Session shows fewer completed than started

Normal if:
- Stopped simulation early
- Browser/connection timeout before completion
- Requests cancelled by closing browser

Check Event Log for actual completion status.
