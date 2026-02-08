# Crash Simulation Guide

## Overview

The crash simulation provides two ways to intentionally terminate the Node.js process: unhandled exceptions and memory exhaustion (OOM). This helps engineers practice crash recovery diagnosis.

## ⚠️ Warning

**These simulations will terminate the process!**

- In Azure App Service, the process restarts automatically
- Locally, you'll need to restart manually
- All in-memory state (simulations, allocations) is lost

## Available Crash Types

### 1. Unhandled Exception

```bash
POST /api/simulations/crash/exception
```

**What happens:**
1. Response sent (202 Accepted)
2. `setImmediate` schedules exception
3. Exception thrown outside try/catch
4. Node.js process terminates with exit code 1

**Exit code:** 1

### 2. Memory Exhaustion (OOM)

```bash
POST /api/simulations/crash/memory
```

**What happens:**
1. Response sent (202 Accepted)
2. Rapid memory allocation begins (100MB chunks)
3. System runs out of memory
4. OS kills process (OOM killer on Linux)

**Exit code:** Varies (137 on Linux = SIGKILL)

## Diagnostic Exercises

### Exercise 1: Crash Recovery Timing

1. Note the current time
2. Trigger a crash
3. Refresh dashboard repeatedly
4. Note when service becomes available again
5. Calculate recovery time

### Exercise 2: Log Analysis After Crash

```bash
# View logs (Azure CLI)
az webapp log tail --name <app> --resource-group <rg>

# Or in Kudu
cat /home/LogFiles/docker/*.log
```

Look for:
- Timestamp of crash
- Error message
- Stack trace (for exception crash)
- OOM messages (for memory crash)

### Exercise 3: Azure Crash Diagnostics

1. Deploy to Azure App Service
2. Trigger crash
3. Go to App Service → Diagnose and Solve Problems
4. Select "Web App Restarted"
5. Review the analysis

## Expected Behavior

### Exception Crash

| Aspect | Behavior |
|--------|----------|
| Exit code | 1 |
| Error message | "Intentional crash: Unhandled exception simulation" |
| Stack trace | Yes (points to crash.service.ts) |
| Memory | Normal |
| Recovery | Automatic restart |

### OOM Crash

| Aspect | Behavior |
|--------|----------|
| Exit code | 137 (SIGKILL) or varies |
| Error message | May not appear (killed by OS) |
| Memory before crash | Maximum available |
| Recovery | Automatic restart |

## Real-World Crash Causes

### Unhandled Exceptions

```javascript
// Async without try/catch
app.get('/data', async (req, res) => {
  const data = await db.query(sql); // Can throw!
  res.json(data);
});

// Better
app.get('/data', async (req, res, next) => {
  try {
    const data = await db.query(sql);
    res.json(data);
  } catch (error) {
    next(error); // Goes to error handler
  }
});
```

### Memory Leaks Leading to OOM

```javascript
// Memory leak - array grows forever
const cache = [];
app.get('/process', (req, res) => {
  cache.push(largeData); // Never cleared!
  res.send('Processed');
});

// Better - use bounded cache
const LRU = require('lru-cache');
const cache = new LRU({ max: 100 });
```

## Prevention and Recovery

### Graceful Shutdown

```javascript
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Log, notify, then exit
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't crash for rejections
});
```

### Memory Monitoring

```javascript
setInterval(() => {
  const usage = process.memoryUsage();
  const heapUsed = usage.heapUsed / 1024 / 1024;
  const heapTotal = usage.heapTotal / 1024 / 1024;
  
  if (heapUsed / heapTotal > 0.9) {
    console.warn('Memory usage critical:', heapUsed.toFixed(2), 'MB');
    // Optionally trigger graceful restart
  }
}, 30000);
```

### Azure Health Checks

Configure health probes in Azure:
- Path: `/api/health`
- Interval: 30 seconds
- Unhealthy threshold: 3

This ensures rapid detection and recovery from unresponsive states.

## Debugging Post-Crash

### Core Dumps (Linux)

Enable core dumps for post-mortem debugging:

```bash
# Enable core dumps
ulimit -c unlimited

# Generate core dump on crash
node --abort-on-uncaught-exception dist/index.js
```

### Azure Collect Diagnostics

1. Go to App Service → Diagnose and Solve Problems
2. Select "Diagnostic Tools"
3. Choose "Collect Memory Dump" or "Collect Profile"
4. Analyze with tools like lldb or Visual Studio
