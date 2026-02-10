# Crash Simulation

Intentionally terminates the Node.js process to practice diagnosing crash recovery and observing restart behavior.

## Crash Types

Four types of crashes available, each mimicking different real-world failure scenarios:

### 1. FailFast (SIGABRT)

**Endpoint:** `POST /api/simulations/crash/failfast`

**Implementation:**
```javascript
process.abort();
```

**Behavior:**
- Immediate process termination
- Generates core dump (if enabled)
- Exit code varies by OS
- No cleanup handlers run

**Real-world equivalent:**
- Native code crash (segfault in addon)
- Assertion failure
- Deliberate abort for diagnostics

### 2. Stack Overflow

**Endpoint:** `POST /api/simulations/crash/stackoverflow`

**Implementation:**
```javascript
function recurse() {
  recurse();  // Infinite recursion
}
recurse();
```

**Behavior:**
- "Maximum call stack size exceeded" error
- Process terminates
- Unrecoverable without process restart

**Real-world equivalent:**
- Runaway recursion in business logic
- Deeply nested data structure processing
- Mutually recursive function bugs

### 3. Unhandled Exception

**Endpoint:** `POST /api/simulations/crash/exception`

**Implementation:**
```javascript
setTimeout(() => {
  throw new Error('Deliberate unhandled exception');
}, 100);
```

**Behavior:**
- Exception bypasses try/catch
- `uncaughtException` event fires (if handler exists)
- Process terminates if not handled
- Async nature makes it harder to catch

**Real-world equivalent:**
- Missing error handling in callbacks
- Rejected promises without .catch()
- Async errors in event handlers

### 4. Memory Exhaustion (OOM)

**Endpoint:** `POST /api/simulations/crash/memory`

**Implementation:**
```javascript
const leak = [];
while (true) {
  leak.push(Buffer.alloc(100 * 1024 * 1024)); // 100MB chunks
}
```

**Behavior:**
- Rapid allocation until heap limit
- "JavaScript heap out of memory" error
- Process killed by V8 or OS OOM killer
- May take a few seconds to fully crash

**Real-world equivalent:**
- Memory leak under load
- Caching without bounds
- Large data processing without streaming

## Dashboard Controls

| Control | Options | Description |
|---------|---------|-------------|
| Crash Type | FailFast, StackOverflow, Exception, Memory | Select crash mechanism |

### Button Action

- **Trigger Crash** - Immediately crashes the process

> ⚠️ **Warning:** The process terminates immediately. Azure App Service will auto-restart.

## Expected Effects

### Immediate

| Effect | All Crash Types |
|--------|-----------------|
| Dashboard | Disconnects |
| WebSocket | Connection lost |
| Active simulations | Lost (in-memory) |
| Process | Terminates |

### After Restart (Azure App Service)

| Effect | Details |
|--------|---------|
| Dashboard | Reconnects automatically |
| Process ID | Changes (shown in Event Log) |
| Simulations | Empty (memory cleared) |
| Event Log | Shows SERVER_STARTED |
| Metrics | Reset to baseline |

### Dashboard Indicators

Upon reconnection:
- Connection status flashes Disconnected → Connected
- Event log shows: "🔄 APPLICATION RESTARTED! Process ID changed..."
- Active Simulations panel clears

## Diagnostic Value

### What Crash Logs Show

**FailFast (SIGABRT):**
```
Process terminated with signal SIGABRT
```

**Stack Overflow:**
```
RangeError: Maximum call stack size exceeded
    at recurse (crash.service.ts:47:5)
    at recurse (crash.service.ts:47:5)
    ... (repeated many times)
```

**Unhandled Exception:**
```
Error: Deliberate unhandled exception
    at Timeout._onTimeout (crash.service.ts:66:11)
```

**Memory Exhaustion:**
```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```
Or on Linux:
```
Killed (OOM killer)
```

### Azure App Service Logs

Crashes appear in:
1. **Log Stream** (real-time)
2. **Kudu → LogFiles → Application**
3. **App Service Diagnostics → Application Crashes**
4. **Application Insights → Failures** (if configured)

## Diagnostic Workflow

### 1. Prepare

- Note current Process ID (via `/api/admin/system-info` or health endpoint)
- Have Azure Portal open to Log Stream
- Open Event Log panel in dashboard

### 2. Trigger Crash

Via dashboard:
1. Select crash type (try "Exception" first - most common)
2. Click "Trigger Crash"

Or via API:
```bash
curl -X POST http://localhost:3000/api/simulations/crash/exception
```

### 3. Observe Crash

**Dashboard:**
- Connection status → "Disconnected"
- Charts stop updating

**Azure Log Stream:**
```
2026-02-10T20:00:00.123Z ERROR Unhandled exception: ...
2026-02-10T20:00:01.456Z INFO  Container exited, restarting...
2026-02-10T20:00:05.789Z INFO  [PerfSimNode] Server running on...
```

### 4. Observe Recovery

**Dashboard:**
- Connection status → "Connected"
- Event Log shows restart message
- Process ID has changed

**Verify via API:**
```bash
curl http://localhost:3000/api/health
# Note new uptime (reset to 0)
```

### 5. Check Logs

**Kudu SSH:**
```bash
# View recent logs
tail -100 /home/LogFiles/Application/*.log

# Search for crash
grep -i "error\|crash\|killed" /home/LogFiles/Application/*.log
```

## Azure Configuration

### Recommended Settings

For crash diagnosis, ensure:

| Setting | Location | Value |
|---------|----------|-------|
| Always On | Configuration → General | On (prevents cold starts) |
| Application Logging | Configuration → Logs | On, File System |
| Log Level | APPLICATIONINSIGHTS_LOG_LEVEL | info or verbose |
| Auto-heal | Configuration → Health checks | Configure thresholds |

### Auto-Heal Rules

Configure automatic recovery for crash patterns:

1. Navigate to **Diagnose and solve problems**
2. Search for "Auto-Heal"
3. Configure rules like:
   - Restart if request time > 60s
   - Restart if memory > 80%
   - Restart on specific status codes

## API Reference

### FailFast

```http
POST /api/simulations/crash/failfast
```

### Stack Overflow

```http
POST /api/simulations/crash/stackoverflow
```

### Unhandled Exception

```http
POST /api/simulations/crash/exception
```

### Memory Exhaustion

```http
POST /api/simulations/crash/memory
```

**Note:** All crash endpoints return nothing (process terminates before response).

## Application Insights Queries

```kusto
// Find all crashes
exceptions
| where timestamp > ago(1h)
| project timestamp, type, outerMessage, details

// Crashes by type
exceptions
| where timestamp > ago(24h)
| summarize count() by type
| order by count_ desc

// Crash correlation with metrics
requests
| where timestamp > ago(1h)
| join kind=inner (
    exceptions
    | where timestamp > ago(1h)
) on operation_Id
| project timestamp, name, duration, exceptionType = type
```

## Troubleshooting

### Process doesn't restart

On local development:
- Normal - no supervisor to restart
- Use `npm run dev` for nodemon auto-restart

On Azure:
1. Check if App Service is stopped
2. Verify Always On is enabled
3. Check deployment slot status

### Dashboard doesn't reconnect

1. WebSocket may need page refresh
2. Check browser console for errors
3. Verify server is actually running (health check)

### Crash not appearing in logs

1. Check logging is enabled
2. Verify log retention settings
3. Some crash types (SIGKILL) may not log

### Memory crash takes too long

1. Heap limit affects time to crash
2. Check `--max-old-space-size` setting
3. OS OOM killer may intervene before V8 limit

## Safety Notes

**Local development:**
- Process stays dead - manually restart
- Use process manager like pm2 for auto-restart

**Production (Azure):**
- Process auto-restarts
- Cold start delay applies
- Multiple crashes may trigger auto-heal/scale
