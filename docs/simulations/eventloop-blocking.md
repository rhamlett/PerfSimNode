# Event Loop Blocking Simulation

Demonstrates how synchronous operations block the Node.js event loop, making the server completely unresponsive.

## How It Works

Executes synchronous `crypto.pbkdf2Sync()` directly in the main JavaScript thread:

```javascript
// Simplified implementation
const startTime = Date.now();
while (Date.now() - startTime < durationMs) {
  crypto.pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
}
```

During this time, **nothing else can execute**:
- No incoming requests processed
- No responses sent
- No timers fire
- No I/O callbacks execute
- No WebSocket heartbeats

## Dashboard Controls

| Control | Range | Description |
|---------|-------|-------------|
| Duration | 1-30 seconds | How long to block (longer may disconnect WebSocket) |

### Button Actions

- **Block Event Loop** - Starts blocking immediately

> ⚠️ **Warning:** There is no "stop" button - once started, the block must complete. The dashboard will freeze.

## Expected Effects

### Metrics (After Block Completes)

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| Event Loop Lag | Spikes to blocking duration | Direct measurement of the block |
| Request Latency | All queued requests complete together | Requests waited in queue |
| CPU | May show spike | Synchronous work consuming CPU |

### What Happens During the Block

| Component | Behavior |
|-----------|----------|
| Dashboard charts | Freeze (no updates) |
| WebSocket | May disconnect if >25s |
| Health checks | Fail/timeout |
| Other requests | Queue, all respond at once after block |
| Probe dots | Turn red (probe failures) |

### Recovery After Block

- Event loop resumes
- All queued requests complete simultaneously
- Metrics broadcast resumes
- Dashboard reconnects (if disconnected)

## Why This Is Critical for Node.js

### The Event Loop Model

```
   ┌───────────────────────────┐
┌─>│           timers          │  (setTimeout, setInterval)
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │  (I/O callbacks)
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare       │
│  └─────────────┬─────────────┘      ┌───────────────┐
│  ┌─────────────┴─────────────┐      │   incoming:   │
│  │           poll            │<─────┤  connections, │
│  └─────────────┬─────────────┘      │   data, etc.  │
│  ┌─────────────┴─────────────┐      └───────────────┘
│  │           check           │  (setImmediate)
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
└──┤      close callbacks      │
   └───────────────────────────┘
```

**Key insight:** If any callback runs too long, the loop cannot advance. Everything waits.

### What Happens to Timers and Probes?

A common question: if the event loop is blocked for 15 seconds, and probes run every 250ms, shouldn't there be 60 probe requests queued up?

**No.** Here's why:

The probe mechanism uses `setTimeout` to schedule the next probe only *after* the current one completes:

```javascript
const scheduleProbe = () => {
  setTimeout(() => {
    // Make HTTP request...
    // When done, schedule the next probe
    scheduleProbe();
  }, 250);
};
```

During an event loop block:

1. **One `setTimeout` is pending** - Its 250ms timer counts down, then the callback enters the event loop queue
2. **The callback waits** - Since the main thread is stuck in a `while` loop doing `pbkdf2Sync`, the callback cannot execute
3. **No new probes are scheduled** - Because scheduling happens inside the callback that's waiting
4. **Only ~3 requests appear** in your latency chart:
   - The probe that was "in flight" when blocking started
   - The pending probe that executes immediately after unblocking
   - Any curl probes (run in child processes, but response handling also waits)

This is fundamentally different from a model where timers "pile up" - **Node.js does not queue multiple instances of the same `setTimeout` callback**. Only one is ever pending at a time.

This behavior perfectly illustrates why blocking the event loop is so dangerous:
- **All timers stop** - Not just delayed, but *frozen*
- **All I/O pauses** - No network, no file system, nothing
- **Health checks fail** - External monitors see the server as dead
- **No work-around** - You can't "background" recovery; the whole process is stuck

This is the core reason Node.js performance best practices emphasize: *never block the event loop*.

### Comparison: CPU Stress vs Event Loop Block

| Aspect | CPU Stress | Event Loop Block |
|--------|------------|------------------|
| Where work runs | Child processes | Main thread |
| Server responsive? | Yes | **No** |
| Other requests affected? | Minimally | **Completely blocked** |
| Event loop lag | Low | **Equals block duration** |
| Can be aborted? | Yes | No |

### Real-World Causes

Event loop blocking in production typically comes from:

1. **Synchronous file operations**
   ```javascript
   // Bad
   const data = fs.readFileSync('large-file.json');
   // Good
   const data = await fs.promises.readFile('large-file.json');
   ```

2. **Synchronous crypto**
   ```javascript
   // Bad
   const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
   // Good  
   const hash = await util.promisify(crypto.pbkdf2)(password, salt, 100000, 64, 'sha512');
   ```

3. **Large JSON parsing**
   ```javascript
   // Can block on very large payloads
   const obj = JSON.parse(hugeString);
   ```

4. **Complex regex on long strings**
   ```javascript
   // Can cause catastrophic backtracking
   const match = longString.match(complexRegex);
   ```

5. **Compute-heavy loops**
   ```javascript
   // Should be in worker_thread or child_process
   for (let i = 0; i < 1000000000; i++) { /* compute */ }
   ```

## Diagnostic Workflow

### 1. Prepare for Block

- Note current event loop lag (should be <1ms)
- Open a second terminal for test requests
- Be ready - dashboard will freeze

### 2. Start Block

Via dashboard or API:
```bash
curl -X POST http://localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 5}'
```

The response arrives **after** the block completes.

### 3. During Block (From Second Terminal)

Try making a request:
```bash
# This will hang until block completes
time curl http://localhost:3000/api/health
```

You'll see it takes ~5 seconds (the block duration) plus normal response time.

### 4. Observe Recovery

- Dashboard reconnects/unfreezes
- Event Loop Lag shows spike (5000ms for 5s block)
- All queued responses arrive simultaneously
- Probe dots show red during block, green after

### 5. Check Event Log

Look for:
- Block start event
- Block completion event  
- Any probe failures during the block

## API Reference

### Block Event Loop

```http
POST /api/simulations/eventloop
Content-Type: application/json

{
  "durationSeconds": 5
}
```

**Response:** (Arrives after block completes)
```json
{
  "id": "el_abc123",
  "type": "EVENT_LOOP_BLOCKING",
  "status": "COMPLETED",
  "parameters": {
    "durationSeconds": 5
  },
  "startTime": "2026-02-10T20:00:00.000Z",
  "endTime": "2026-02-10T20:00:05.000Z"
}
```

## Azure Diagnostics

### What to Look For

In a production incident, event loop blocking manifests as:

1. **Sudden latency spike** affecting ALL requests
2. **Health probes fail** during the block
3. **WebSocket disconnections**
4. **Requests complete in batches** after block releases

### Application Insights

```kusto
// Find latency spikes indicating blocking
requests
| where timestamp > ago(1h)
| summarize 
    avg(duration) by bin(timestamp, 10s),
    percentile(duration, 99)
| where percentile_duration_99 > 5000
| render timechart

// Correlation: all requests at same time = queued during block
requests
| where timestamp > ago(1h)
| summarize count() by bin(timestamp, 1s)
| where count_ > 10  // Many requests completing together
```

### Linux Profiling (Advanced)

Using V8 Profiler:
```bash
# Start app with inspector
node --inspect dist/index.js

# Take CPU profile during suspected blocking
# Use Chrome DevTools → Performance tab
```

Or use `clinic.js`:
```bash
npx clinic doctor -- node dist/index.js
# Then trigger the block and analyze results
```

## What to Observe in Dashboard

### Before Block

- Event Loop Lag: ~0ms
- Probe dots: Green
- Dashboard: Updating smoothly

### During Block

- Dashboard: Frozen
- Probe dots: Stop updating (then show red when recovered)
- No new data points on charts

### After Block

- Event Loop Lag: Spikes to block duration (e.g., 5000ms)
- Probe dots: May show red for missed probes, then green
- Charts: Catch up with queued data

## Troubleshooting

### Dashboard doesn't recover

1. WebSocket likely disconnected during long block
2. Refresh page to reconnect
3. Check Event Log for reconnection events

### Block seems longer than configured

1. GC may have run during/after block
2. Check CPU - if maxed, blocking work takes longer
3. Queued work adds to perceived time

### Can't tell blocking from CPU stress

**Key differentiator:** Event Loop Lag metric
- CPU stress: Event loop lag stays low (<10ms)
- Event loop blocking: Lag equals block duration
