# Research: Performance Problem Simulator

**Feature**: 001-perf-simulator-node  
**Date**: 2026-02-08  
**Purpose**: Document technology decisions and best practices for implementation

## CPU Stress Simulation

### Decision: Use `crypto.pbkdf2Sync` for CPU load

**Rationale**: The Node.js `crypto` module provides CPU-intensive operations that are
predictable and controllable. `pbkdf2Sync` (Password-Based Key Derivation Function 2)
performs iterative hashing that scales linearly with iteration count.

**Alternatives Considered**:
- **Tight computational loops**: Less predictable CPU usage, may be optimized away by V8
- **Worker threads with busy loops**: More complex, requires thread management
- **External native modules**: Adds dependency complexity, not needed for this use case

**Implementation Notes**:
```typescript
// Example: Generate CPU load for specified duration
import { pbkdf2Sync } from 'crypto';

/**
 * Performs CPU-intensive work for approximately the specified duration.
 * Uses PBKDF2 with calibrated iterations to achieve target load.
 */
function cpuBurn(durationMs: number): void {
  const endTime = Date.now() + durationMs;
  while (Date.now() < endTime) {
    // Each call consumes ~1-2ms of CPU time
    pbkdf2Sync('password', 'salt', 1000, 64, 'sha512');
  }
}
```

**Target Load Percentage**: Achieving a specific CPU percentage requires calibration.
A simpler approach is to run the burn loop in bursts (e.g., burn for X ms, sleep for Y ms)
where the ratio X/(X+Y) approximates target load.

---

## Memory Pressure Simulation

### Decision: Use `Buffer.alloc` with allocation tracking

**Rationale**: Node.js `Buffer` objects allocate memory outside V8's heap but are still
tracked by the garbage collector. `Buffer.alloc(size)` creates zero-filled buffers of
exact size, making memory consumption predictable.

**Alternatives Considered**:
- **Large JavaScript arrays**: Heap memory, but size is less predictable due to V8 optimizations
- **Typed arrays (Uint8Array)**: Similar to Buffer, but Buffer is more idiomatic in Node.js
- **External memory via native modules**: Unnecessary complexity

**Implementation Notes**:
```typescript
// Track allocations for explicit release
const allocations: Map<string, Buffer> = new Map();

/**
 * Allocates a buffer of specified size (in MB) and tracks it for later release.
 */
function allocateMemory(sizeMb: number): string {
  const id = crypto.randomUUID();
  const buffer = Buffer.alloc(sizeMb * 1024 * 1024);
  allocations.set(id, buffer);
  return id;
}

function releaseMemory(id: string): boolean {
  return allocations.delete(id);
}
```

**Note**: Buffers are not immediately garbage collected when deleted from the map.
Calling `global.gc()` (requires `--expose-gc` flag) can force collection, but this
is not recommended in production. For this training tool, natural GC is acceptable.

---

## Event Loop Lag Measurement

### Decision: Use `perf_hooks.monitorEventLoopDelay`

**Rationale**: Node.js 12+ provides `monitorEventLoopDelay` in the `perf_hooks` module,
which samples event loop delay with nanosecond precision using a histogram.

**Alternatives Considered**:
- **setTimeout polling**: `setTimeout(() => {}, 0)` and measure actual delay. Simple but less accurate.
- **`process._getActiveHandles()`**: Provides handle count but not timing information
- **Third-party modules**: Unnecessary dependency

**Implementation Notes**:
```typescript
import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';

const histogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

/**
 * Returns event loop lag statistics in milliseconds.
 */
function getEventLoopLag(): { min: number; max: number; mean: number; p99: number } {
  return {
    min: histogram.min / 1e6,      // Convert nanoseconds to milliseconds
    max: histogram.max / 1e6,
    mean: histogram.mean / 1e6,
    p99: histogram.percentile(99) / 1e6,
  };
}
```

---

## Event Loop Blocking Simulation

### Decision: Use `crypto.pbkdf2Sync` in long-running loop

**Rationale**: Synchronous operations block the event loop. Using the same crypto
operation as CPU stress provides consistency and clearly demonstrates blocking behavior.

**Alternatives Considered**:
- **`fs.readFileSync` on large files**: Requires file existence, I/O-bound rather than CPU-bound
- **`JSON.parse` on large strings**: Memory-intensive, less controllable
- **Busy-wait loop**: May be optimized by V8, less reliable

**Implementation Notes**:
```typescript
/**
 * Blocks the event loop for approximately the specified duration.
 * WARNING: This will make the server unresponsive during execution.
 */
function blockEventLoop(durationMs: number): void {
  const endTime = Date.now() + durationMs;
  while (Date.now() < endTime) {
    pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
  }
}
```

---

## Real-Time Metrics Broadcasting

### Decision: Socket.IO with 1-second broadcast interval

**Rationale**: Socket.IO provides WebSocket abstraction with automatic fallback to
long-polling, reconnection handling, and room-based broadcasting. A 1-second interval
balances responsiveness with network efficiency.

**Alternatives Considered**:
- **Raw WebSocket API**: More complex connection management
- **Server-Sent Events (SSE)**: Simpler but unidirectional (client cannot send commands)
- **Polling**: Higher latency, more server load

**Implementation Notes**:
```typescript
import { Server as SocketServer } from 'socket.io';

// Broadcast metrics every second
setInterval(() => {
  const metrics = collectMetrics();
  io.emit('metrics', metrics);
}, 1000);
```

---

## Azure App Service Linux Deployment

### Decision: Use `process.env.PORT` with fallback, no special startup file needed

**Rationale**: Azure App Service Linux sets the `PORT` environment variable. The Node.js
blessed image automatically runs `npm start` or detects `server.js`/`index.js`.

**Considerations**:
- **WebSocket support**: App Service supports WebSockets natively; ensure "Web sockets" is enabled in Configuration
- **Health checks**: App Service pings the root path; ensure a handler exists
- **Logging**: `console.log` output goes to App Service logs (Log Stream, Kudu)
- **Process management**: App Service uses PM2 internally; crash recovery is automatic

**Implementation Notes**:
```typescript
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**No web.config needed**: Unlike Windows App Service, Linux App Service does not use web.config.
The `package.json` `start` script is sufficient.

---

## Frontend Charting

### Decision: Chart.js via CDN, no build step

**Rationale**: Chart.js is lightweight, well-documented, and can be loaded directly
from a CDN. This eliminates the need for a frontend build process, aligning with the
Simplicity principle.

**Alternatives Considered**:
- **D3.js**: More powerful but significantly more complex for simple line charts
- **Lightweight alternatives (uPlot, Frappe Charts)**: Less ecosystem support
- **No charts (text only)**: Reduces learning value of visual feedback

**Implementation Notes**:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  const ctx = document.getElementById('cpuChart').getContext('2d');
  const cpuChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'CPU %', data: [] }] },
    options: { animation: false, scales: { y: { min: 0, max: 100 } } }
  });
</script>
```

---

## Summary of Technology Decisions

| Component | Choice | Key Reason |
|-----------|--------|------------|
| CPU Stress | crypto.pbkdf2Sync | Predictable, no dependencies |
| Memory Allocation | Buffer.alloc | Exact sizing, trackable |
| Event Loop Monitoring | perf_hooks.monitorEventLoopDelay | Native, nanosecond precision |
| Event Loop Blocking | Synchronous crypto operations | Consistent with CPU stress |
| Real-Time Updates | Socket.IO | Reconnection, fallbacks, bidirectional |
| Frontend Charts | Chart.js via CDN | No build step, well-documented |
| Deployment | Standard npm start | App Service Linux compatible |
