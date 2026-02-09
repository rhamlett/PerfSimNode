# Azure Diagnostics Guide for Node.js

This guide covers diagnostic tools and techniques for troubleshooting Node.js applications running on Azure App Service, with a focus on understanding what the metrics mean and how to diagnose common performance issues.

## Understanding Dashboard Metrics

### CPU Usage (%)

**What it measures:** Percentage of CPU time consumed by the Node.js process.

**Why it matters:** High CPU indicates compute-bound operations. In Node.js, this typically means synchronous code is running (crypto operations, JSON parsing large objects, complex calculations).

**Normal range:** 0-30% at idle, spikes during requests are normal.

**Warning signs:** Sustained >70% indicates a problem.

### Memory Working Set (MB)

**What it measures:** Total memory the Node.js process has allocated and is actively using.

**Why it matters:** Memory that grows without releasing indicates leaks. Node.js uses V8's garbage collector, but references held too long prevent cleanup.

**Normal range:** Depends on the application, but should stabilize after warmup.

**Warning signs:** Continuous growth over time (sawtooth pattern is OK—that's normal GC behavior).

### Event Loop Lag (ms)

**What it measures:** Time between when a callback is scheduled and when it actually executes.

**Why it matters:** This is the KEY METRIC for sync-over-async problems! When synchronous code blocks the event loop, ALL pending callbacks must wait—including incoming HTTP requests.

**Normal range:** <10ms

**Warning signs:** >100ms causes noticeable delays; >1000ms means severe blocking.

### Request Latency (ms)

**What it measures:** Time from request received to response sent, including time waiting in the event loop queue.

**Why it matters:** Direct measure of user experience. High latency with low CPU often indicates blocking or external dependency issues.

**Normal range:** <150ms for simple requests

**Warning signs:** >1s degraded; >30s critical (browser timeouts).

---

## Node.js vs .NET: Understanding the Difference

If you're familiar with diagnosing .NET applications, here's how Node.js differs:

| Aspect | .NET (Thread Pool) | Node.js (Event Loop) |
|--------|-------------------|---------------------|
| Concurrency Model | Multiple threads in a pool | Single thread with async I/O |
| Sync-over-Async Impact | Blocks ONE thread | Blocks THE thread (all requests wait) |
| Key Metric for Blocking | Thread Pool Threads / Queue Length | Event Loop Lag |
| What Gets Starved | Thread pool → requests queue | Event loop → all callbacks queue |
| Recovery | Automatic as threads free up | Only when blocking code completes |
| Scaling | More threads (up to limit) | Cluster mode (multiple processes) |

### Why "Event Loop Lag" Replaces "Thread Pool Metrics"

In .NET, you watch the thread pool to see if sync-over-async is starving threads. In Node.js:

- **Thread Pool** → Not applicable (only 1 main thread for JavaScript execution)
- **Queue Length** → Replaced by **Event Loop Lag** (shows how long callbacks wait)

### Key Insight

Unlike .NET's thread pool (which has multiple threads that can be exhausted), Node.js has a **single-threaded event loop**. When you see high Event Loop Lag, it means the main thread is blocked—equivalent to ALL threads being busy in a .NET thread pool.

### Node.js Does Have a Thread Pool (libuv)

Node.js uses a background thread pool (libuv, default 4 threads) for:
- File system operations
- DNS lookups
- Some crypto operations
- Compression

However, this is separate from the main event loop. Exhausting the libuv pool slows I/O operations but doesn't block the event loop directly.

---

## Diagnostic Scenarios

### 🔥 High CPU Usage

**Symptom:** CPU metric pinned high, requests may still complete but slower.

**What's Happening:**
- CPU-intensive operations (crypto, parsing, calculations)
- Synchronous operations keep CPU busy
- Event loop still runs between operations

**Azure Diagnostic Tools:**
- App Service Diagnostics → **CPU Drill Down**
- Application Insights → **Performance**
- Kudu → **Process Explorer**

**What to Look For:**
- Which process is consuming CPU
- CPU profiler to find hot code paths
- Correlation with specific requests

### 📊 Memory Pressure

**Symptom:** Memory grows, stays high, may eventually crash with OOM.

**What's Happening:**
- Objects allocated but references held (can't be garbage collected)
- Common causes: growing caches, event listener leaks, closures holding references
- Simulates memory leaks from caching gone wrong

**Azure Diagnostic Tools:**
- App Service Diagnostics → **Memory Analysis**
- Application Insights → **Metrics**
- Kudu → **Process Explorer**

**What to Look For:**
- Heap snapshots to find retained objects
- Memory growth pattern (leak vs. normal usage)
- Correlation with specific operations

### 🧵 Event Loop Blocking (Sync-over-Async)

**Symptom:** Event Loop Lag spikes, ALL requests become slow simultaneously.

**What's Happening:**
- Synchronous code blocks the single main thread
- All pending callbacks must wait
- Request latency = lag + actual processing time

**Azure Diagnostic Tools:**
- Application Insights → **Performance**
- App Service Diagnostics → **Web App Slow**
- Custom metrics with `perf_hooks`

**What to Look For:**
- Event loop lag correlating with slow requests
- All requests affected at the same time (not just some)
- CPU may be low (if blocking on sync I/O like `fs.readFileSync`)

### 🐢 Slow Requests

**Symptom:** Some requests take very long, latency monitor shows high values.

**What's Happening:**
- Request handler intentionally delays (simulating slow dependencies)
- Simulates slow database queries, external API calls
- With blocking version, affects other requests too

**Azure Diagnostic Tools:**
- Application Insights → **End-to-end transaction details**
- App Service Diagnostics → **Web App Slow**
- Log Analytics → Request duration queries

**What to Look For:**
- Which endpoint is slow
- Dependency timing breakdown
- Whether other requests are affected (indicates blocking vs. just slow)

### 💥 Application Crash

**Symptom:** App becomes unresponsive, restarts, or returns 502/503 errors.

**What's Happening:**
- Unhandled exception crashes process
- OOM killer terminates process
- App Service may auto-restart

**Azure Diagnostic Tools:**
- App Service Diagnostics → **Web App Restarted**
- Application Insights → **Failures**
- Kudu → **LogFiles**

**What to Look For:**
- Crash dump analysis
- Exception stack trace in logs
- Memory usage before crash (for OOM)

---

## Azure Diagnostic Tools

### App Service Diagnostics

Built-in diagnostic reports in Azure Portal. Access via **"Diagnose and solve problems"** in your App Service blade.

**Key Reports:**
- **Availability and Performance** - Overall health status
- **CPU Drill Down** - Detailed CPU analysis by process
- **Memory Analysis** - Heap usage and growth patterns
- **Web App Slow** - Request latency analysis
- **Web App Restarted** - Crash and restart investigation

### Application Insights

Full APM solution with request tracing, dependency tracking, and custom metrics.

**Key Features:**
- **Application Map** - Visual service dependencies
- **Performance** - Request duration, dependency calls
- **Failures** - Exceptions, failed requests
- **Live Metrics** - Real-time streaming dashboard

### Kudu (SCM)

Developer console at `https://yourapp.scm.azurewebsites.net`

**Key Features:**
- **Process Explorer** - View running processes, CPU/memory per process
- **Debug Console** - Bash/PowerShell access to file system
- **Log Stream** - Real-time log streaming
- **LogFiles** - Historical log access and download

### Log Analytics

Query-based log analysis with KQL (Kusto Query Language).

**Best for:** Historical analysis, custom queries, alerting.

### Azure Monitor Metrics

Platform metrics for CPU, memory, requests, etc.

**Best for:** Real-time monitoring, dashboards, alerts.

---

## Diagnostic Workflow

### Step 1: Initial Assessment

1. Check App Service Overview for health status
2. Look at CPU, Memory, Request metrics in Azure Monitor
3. Note the timeframe of the issue

### Step 2: Identify the Pattern

| If You See... | Likely Issue | Next Step |
|---------------|--------------|-----------|
| High CPU, normal response times | CPU-bound processing | CPU profiling via Kudu |
| High CPU, slow responses | CPU starvation | Identify hot code path |
| Normal CPU, slow ALL responses | Event loop blocking | Check event loop metrics, code review |
| Normal CPU, slow SOME responses | External dependency latency | Application Insights dependency view |
| Memory growing over time | Memory leak | Heap snapshot analysis |
| Sudden restarts, 502 errors | Crash (exception or OOM) | Crash dump, error logs |

### Step 3: Deep Dive

Based on the pattern identified, use the appropriate tools:

**High CPU:**
1. Kudu Process Explorer → Identify process
2. App Service Diagnostics → CPU Drill Down
3. Profile with `node --prof` or `--inspect`

**Event Loop Blocking:**
1. Check Application Insights for correlated slow requests
2. Look for sync operations in code (`fs.readFileSync`, etc.)
3. Add monitoring with `perf_hooks.monitorEventLoopDelay()`

**Memory Leak:**
1. Take heap snapshot via Kudu or remote debugging
2. Compare snapshots over time
3. Look for growing object counts

---

## Kudu Console Commands

### Process Information

```bash
# List Node.js processes
ps aux | grep node

# Show memory usage
free -m

# CPU and memory in real-time
top -p $(pgrep -f node)
```

### Profiling

```bash
# Generate CPU profile
node --prof /home/site/wwwroot/index.js

# Process the profile
node --prof-process isolate-*.log > profile.txt
```

### Heap Snapshot

```bash
# Find Node.js PID
pgrep -f node

# Send signal to generate heap snapshot
kill -USR2 <pid>
```

### Log Analysis

```bash
# View recent application logs
tail -100 /home/LogFiles/Application/*.log

# Search for errors
grep -i "error\|exception" /home/LogFiles/Application/*.log

# Watch logs in real-time
tail -f /home/LogFiles/Application/*.log
```

---

## Application Insights Queries (KQL)

### Slow Requests

```kql
requests
| where timestamp > ago(1h)
| where duration > 5000
| summarize count() by bin(timestamp, 5m), name
| render timechart
```

### Failed Requests

```kql
requests
| where timestamp > ago(1h)
| where success == false
| summarize count() by resultCode, name
| order by count_ desc
```

### Exception Breakdown

```kql
exceptions
| where timestamp > ago(24h)
| summarize count() by type, outerMessage
| order by count_ desc
```

### Dependency Latency

```kql
dependencies
| where timestamp > ago(1h)
| summarize avg(duration), percentile(duration, 95) by name
| order by avg_duration desc
```

---

## Best Practices

1. **Always enable Application Insights** for production apps
2. **Set up alerts** for key metrics (CPU, memory, response time, event loop lag)
3. **Configure diagnostic logging** to Azure Blob Storage for retention
4. **Use deployment slots** for testing and easy rollback
5. **Monitor event loop health** with custom metrics using `perf_hooks`
6. **Avoid sync operations** in request handlers (`readFileSync`, `execSync`, etc.)
7. **Use cluster mode** or Azure's scaling for high-traffic scenarios
