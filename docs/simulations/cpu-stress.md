# CPU Stress Simulation

Generates controlled CPU load to practice diagnosing high CPU conditions in Node.js applications.

## How It Works

Unlike simple CPU burning in the main thread (which would block Node.js), this simulation uses **`child_process.fork()`** to spawn separate OS processes:

1. Request received → Simulation service calculates required worker processes
2. For N% CPU on M cores: spawns `ceil(N/100 * M)` child processes
3. Each child process runs a tight `while(true)` loop with `crypto.pbkdf2Sync()`
4. OS scheduler distributes processes across available CPU cores
5. After duration expires, all child processes are terminated via IPC

### Why Child Processes?

| Approach | Problem |
|----------|---------|
| Main thread CPU burn | Blocks event loop - server becomes unresponsive |
| Worker threads | Share process memory limit, may not hit target CPU |
| **Child processes** | True OS process isolation, guaranteed CPU utilization |

## Dashboard Controls

| Control | Range | Description |
|---------|-------|-------------|
| Target Load | 1-100% | Desired CPU utilization percentage |
| Duration | 1-300s | How long to run the stress test |

### Button Actions

- **Start CPU Stress** - Begins simulation with configured parameters
- **Stop** - Immediately terminates all worker processes

## Expected Effects

### Metrics

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| CPU % | Increases to target | Worker processes consuming CPU |
| Event Loop Lag | Minimal change | Work is in child processes, not main thread |
| Memory | Slight increase | Child process memory overhead |
| Request Latency | May increase slightly | CPU contention at system level |

### Dashboard Behavior

- CPU tile turns yellow/red based on utilization
- CPU chart shows usage spike
- Active Simulations panel shows running simulation
- Event Log shows start/stop events

### System Behavior

- `top`/`htop` shows multiple node processes
- Child processes named similar to main process
- CPU utilization matches target (approximately)

## CPU Metric Measurement

### High-Resolution Sampling

The dashboard samples CPU metrics at **250ms intervals** using `os.cpus()` for system-wide measurement. This high-resolution approach reveals real system behavior but can show significant fluctuations even when idle:

| Behavior | Cause |
|----------|-------|
| 0-90% spikes at idle | Short bursts of activity (GC, curl, I/O) within measurement window |
| Rapid fluctuations | Container scheduling on shared infrastructure |
| Brief CPU bursts | V8 garbage collection, JIT compilation |

### Why Raw Data?

Production monitoring tools (Azure Monitor, Prometheus) typically sample every 15-60 seconds and smooth the data. This dashboard intentionally shows **unsmoothed high-resolution data** to:

1. **Reveal real system behavior** - See GC pauses, scheduling artifacts
2. **Educational value** - Understand how Linux CPU measurement works
3. **Detect brief anomalies** - Short blocking operations visible

### Comparison to Production Tools

| Tool | Sample Interval | Smoothing |
|------|-----------------|-----------|
| This Dashboard | 250ms | None (raw) |
| Azure App Service Metrics | 1 minute | Averaged |
| Application Insights | 1 minute | Aggregated |
| Linux `top` | 3 seconds | Per-interval |

> **Tip:** When diagnosing CPU issues, start a simulation and watch the **trend** rather than individual values. The important signal is sustained elevation, not momentary spikes.

## Node.js Characteristics

### Why This Matters

In .NET, the thread pool handles concurrent CPU work automatically. In Node.js:

- Single thread means synchronous CPU work blocks everything
- Child processes are the standard pattern for CPU-intensive work
- Cluster module uses similar approach for multi-core utilization

### Production Implications

High CPU in production Node.js apps typically indicates:
1. Synchronous operations blocking event loop (bad pattern)
2. Heavy JSON parsing/serialization
3. Complex regex operations
4. Crypto operations without async variants
5. Legitimate compute-heavy workloads (should use worker_threads or child processes)

## Diagnostic Workflow

### 1. Observe Baseline

Before starting simulation, note:
- Current CPU %
- Request latency
- Event loop lag

### 2. Start Simulation

Run a 30-second simulation at 75% CPU:
```bash
curl -X POST http://localhost:3000/api/simulations/cpu \
  -H "Content-Type: application/json" \
  -d '{"targetLoadPercent": 75, "durationSeconds": 30}'
```

### 3. During Simulation

**Dashboard:**
- Verify CPU metric increases
- Check if latency increases (indicates CPU contention)
- Event loop lag should stay low

**Linux Tools (via Kudu SSH):**
```bash
# View all node processes
ps aux | grep node

# Real-time CPU view
top -p $(pgrep -d',' node)

# Process tree showing parent/child
pstree -p $(pgrep -f "node dist/index")
```

### 4. After Simulation

- CPU returns to baseline
- Event log shows completion
- No orphan processes remain

## API Reference

### Start CPU Stress

```http
POST /api/simulations/cpu
Content-Type: application/json

{
  "targetLoadPercent": 75,
  "durationSeconds": 30
}
```

**Response:**
```json
{
  "id": "cpu_abc123",
  "type": "CPU_STRESS",
  "status": "ACTIVE",
  "parameters": {
    "targetLoadPercent": 75,
    "durationSeconds": 30
  },
  "startTime": "2026-02-10T20:00:00.000Z"
}
```

### Stop CPU Stress

```http
DELETE /api/simulations/cpu/{id}
```

## Azure Diagnostics

### App Service Diagnostics

1. Navigate to **Diagnose and solve problems**
2. Select **Availability and Performance** → **High CPU**
3. Look for CPU spikes correlating with simulation times

### Application Insights

```kusto
// CPU usage over time
performanceCounters
| where name == "% Processor Time"
| summarize avg(value) by bin(timestamp, 1m)
| render timechart
```

### AppLens Queries

```kusto
// Process CPU consumption
AntaresRuntimeWorkerLog
| where TIMESTAMP > ago(1h)
| where ProcessCpuPercent > 50
| project TIMESTAMP, ProcessCpuPercent, ProcessName
```

## Troubleshooting

### CPU doesn't reach target

1. **App Service SKU** - Shared/Free tiers have CPU throttling
2. **Container limits** - Check if resource limits are configured
3. **Measurement method** - `os.cpus()` measures system-wide; ensure no other processes

### CPU shows higher than configured

- Other processes on same host consuming CPU
- GC activity from memory pressure
- OS background tasks

### Simulation doesn't stop

1. Check Event Log for errors
2. Manually stop via API: `DELETE /api/simulations/cpu/{id}`
3. Restart application if child processes orphaned
