# CPU Stress Simulation Guide

## Overview

The CPU stress simulation generates high CPU usage by performing cryptographic operations in a controlled manner. This helps engineers practice diagnosing CPU-bound performance issues.

## How It Works

The simulation uses `crypto.pbkdf2Sync()` (Password-Based Key Derivation Function 2) to perform CPU-intensive operations. The algorithm:

1. Runs in 100ms intervals
2. Burns CPU for `(targetLoadPercent / 100) * 100ms` each interval
3. Allows the event loop to handle other work during the remaining time

This approach provides controllable, measurable CPU load while still allowing the server to remain responsive.

## API Usage

### Start CPU Stress

```bash
POST /api/simulations/cpu
Content-Type: application/json

{
  "targetLoadPercent": 80,
  "durationSeconds": 30
}
```

**Parameters:**
- `targetLoadPercent` (1-100): Target CPU usage percentage
- `durationSeconds` (1-300): Duration in seconds

**Response:**
```json
{
  "id": "uuid-of-simulation",
  "type": "CPU_STRESS",
  "message": "CPU stress simulation started at 80% for 30s",
  "scheduledEndAt": "2024-02-08T12:30:30.000Z"
}
```

### Stop CPU Stress

```bash
DELETE /api/simulations/cpu/{id}
```

### List Active CPU Simulations

```bash
GET /api/simulations/cpu
```

## Concurrent Simulations

Multiple CPU stress simulations can run simultaneously. The effects stack - two 50% simulations will result in approximately 100% CPU usage.

## Diagnostic Exercises

### Exercise 1: Identify High CPU Process

1. Start a CPU stress simulation at 80%
2. Open terminal and run `top` or `htop`
3. Identify the Node.js process with high CPU
4. Note the PID and CPU percentage

### Exercise 2: CPU Profiling

1. Start the application with profiling enabled:
   ```bash
   node --prof dist/index.js
   ```
2. Trigger CPU stress simulation
3. Stop and process the profile:
   ```bash
   node --prof-process isolate-*.log
   ```
4. Analyze the output for hot functions

### Exercise 3: Azure Diagnostics

1. Deploy to Azure App Service
2. Start CPU stress simulation
3. Navigate to App Service → Diagnose and Solve Problems
4. Select "High CPU" diagnostic
5. Review the analysis and recommendations

## Expected Observations

When running CPU stress:

| Metric | Expected Behavior |
|--------|-------------------|
| CPU % | Approximately matches targetLoadPercent |
| Event loop lag | Minimal increase (< 100ms) |
| Response time | Slight increase due to CPU contention |
| Memory | No significant change |

## Technical Details

### PBKDF2 Algorithm

The simulation uses PBKDF2 with:
- 1000 iterations per call
- SHA-512 hash function
- 64-byte output

Each call consumes approximately 1-2ms of CPU time. The loop continues calling until the burn time is exhausted.

### Load Calibration

Actual CPU percentage may vary based on:
- System CPU count
- Other processes competing for CPU
- V8 JIT compilation state
- Thermal throttling

The simulation targets single-core load. On multi-core systems, total system CPU will be lower than targetLoadPercent.
