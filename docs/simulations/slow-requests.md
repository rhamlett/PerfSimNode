# Slow Request Simulation

Simulates slow HTTP responses using various blocking patterns to practice diagnosing latency issues and resource contention.

## Blocking Patterns

PerfSimNode offers three blocking patterns, each simulating different real-world scenarios:

### 1. setTimeout (Non-Blocking)

Uses JavaScript's `setTimeout()` to delay the HTTP response.

```javascript
await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
```

**Characteristics:**
- Server remains fully responsive to other requests
- No resource contention
- Probe latency stays normal
- Event loop not blocked

**Use case:** Simulating slow external API calls where Node.js is just waiting.

### 2. libuv Thread Pool Saturation

Saturates the libuv thread pool (default: 4 threads) with synchronous crypto operations.

```javascript
// Blocks libuv threads with CPU-intensive sync work
pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
```

**Characteristics:**
- Blocks the libuv thread pool used by fs, dns, crypto
- Other file system operations queue up
- DNS lookups become slow
- Similar to .NET ThreadPool exhaustion

**Use case:** Simulating scenarios where blocking I/O operations saturate the thread pool.

**Real-world parallel:** This is analogous to .NET ThreadPool starvation, where sync-over-async patterns block ThreadPool threads causing all work items to queue.

### 3. Worker Thread Blocking

Spawns Node.js Worker Threads that perform CPU-intensive blocking work.

```javascript
// Worker thread with blocking loop
const worker = new Worker('./slow-request-worker.js', {
  workerData: { durationMs }
});
```

**Characteristics:**
- Creates actual OS threads
- Each request blocks a worker thread
- Closest parallel to .NET ThreadPool work items
- Thread count visible in process metrics

**Use case:** Simulating CPU-bound work in worker threads, similar to .NET ThreadPool blocking patterns.

## Dashboard Controls

| Control | Range | Description |
|---------|-------|-------------|
| Blocking Pattern | dropdown | setTimeout, libuv, or worker |
| Delay (seconds) | 1-300 | How long each request takes |
| Interval (seconds) | 1-60 | Time between automated requests |
| Max Requests | 1-100 | Total requests to send |

### Button Actions

- **Start Slow Requests** - Begins sending requests at configured interval
- **Stop** - Cancels remaining requests (in-flight requests complete normally)

## Expected Effects by Pattern

### setTimeout (Non-Blocking)

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| Event Loop Lag | **No change** | setTimeout doesn't block |
| CPU | Minimal | No compute work |
| Probe Latency | **No change** | Other requests unaffected |

### libuv Thread Pool Saturation

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| Event Loop Lag | May increase slightly | Event loop waits for libuv callbacks |
| File operations | **Slow down** | Thread pool saturated |
| DNS lookups | **Slow down** | Also use libuv threads |
| Probe Latency | Mostly normal | HTTP doesn't use libuv pool |

### Worker Thread Blocking

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| Event Loop Lag | **No change** | Workers are separate threads |
| CPU | Increases | Workers doing CPU work |
| Thread count | Increases | New worker threads created |
| Probe Latency | **No change** | Main thread unaffected |

## Comparison: Node.js vs .NET

| .NET Pattern | Node.js Equivalent | Resource Affected |
|--------------|-------------------|-------------------|
| ThreadPool.QueueUserWorkItem with blocking | Worker Thread Blocking | Worker threads/CPU |
| Sync database call on ThreadPool | libuv Thread Pool Saturation | libuv threads (fs/dns/crypto) |
| async/await with Task.Delay | setTimeout (non-blocking) | None (just timer) |

## API Reference

### Slow Request

```http
GET /api/simulations/slow?delaySeconds=10&blockingPattern=libuv
```

**Parameters:**
- `delaySeconds` (number): How long to delay (default: 5)
- `blockingPattern` (string): `setTimeout`, `libuv`, or `worker` (default: setTimeout)

**Response:** (Arrives after delay)
```json
{
  "id": "slow_abc123",
  "type": "SLOW_REQUEST",
  "status": "COMPLETED",
  "requestedDelaySeconds": 10,
  "blockingPattern": "libuv",
  "actualDurationMs": 10003,
  "timestamp": "2026-02-10T20:00:10.000Z"
}
```

## Diagnostic Workflow

### 1. Baseline

Verify normal latency before starting:
- Probe dots are green
- Current latency: ~10-50ms

### 2. Test Each Pattern

**setTimeout (reference):**
```bash
curl "http://localhost:3000/api/simulations/slow?delaySeconds=10&blockingPattern=setTimeout"
```
- Health probe stays fast
- No resource contention

**libuv saturation:**
```bash
# Terminal 1: Start slow request
curl "http://localhost:3000/api/simulations/slow?delaySeconds=30&blockingPattern=libuv"

# Terminal 2: Try file operation (will be slow if thread pool saturated)
# Watch for slower fs operations in other parts of your app
```

**Worker thread blocking:**
```bash
curl "http://localhost:3000/api/simulations/slow?delaySeconds=30&blockingPattern=worker"
```
- Watch thread count increase
- CPU usage increases

### 3. Concurrent Requests

Send multiple requests to observe queuing behavior:
```bash
# Send 4 concurrent libuv requests (saturates default thread pool)
for i in {1..4}; do
  curl "http://localhost:3000/api/simulations/slow?delaySeconds=10&blockingPattern=libuv" &
done
wait
```

## Environment Variable

Control libuv thread pool size:
```bash
# Increase libuv thread pool before starting Node.js
UV_THREADPOOL_SIZE=8 npm start
```

Default is 4 threads. Maximum is 1024.

## Azure Diagnostics

### Identifying Thread Pool Issues

**Application Insights:**
```kusto
// Find slow requests by blocking pattern (if logged)
traces
| where message contains "libuv" or message contains "worker"
| summarize count() by message
| order by count_ desc
```

### Key Pattern Recognition

| Symptom | Likely Pattern |
|---------|---------------|
| fs operations slow, HTTP fast | libuv saturation |
| High CPU, low event loop lag | Worker or CPU stress |
| All requests slow equally | Event loop blocking |
| Only specific endpoints slow | Application logic issue |

## Probe Frequency Note

During slow request testing, probe frequency automatically reduces:

| Mode | Interval | Reason |
|------|----------|--------|
| Normal | 250ms | Real-time dashboard updates |
| During slow requests | 2500ms | Reduces noise for profiler/diagnostics |
