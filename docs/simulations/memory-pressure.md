# Memory Pressure Simulation

Allocates and retains memory to simulate memory leaks or high memory usage conditions.

## How It Works

1. Request received with size in MB
2. Creates array of `Buffer` objects filled with random data
3. Holds references to buffers, preventing garbage collection
4. Memory remains allocated until explicitly released via DELETE endpoint

```javascript
// Simplified implementation
const chunks = [];
for (let i = 0; i < sizeMb; i++) {
  const buffer = Buffer.alloc(1024 * 1024); // 1MB
  crypto.randomFillSync(buffer); // Prevent optimization
  chunks.push(buffer);
}
// chunks held in memory until released
```

### Why Random Data?

V8 (Node.js JavaScript engine) can optimize away unused allocations. Filling buffers with random data ensures:
- Memory is actually committed
- Pages are not deduplicated by OS
- GC cannot optimize away the allocation

## Dashboard Controls

| Control | Range | Description |
|---------|-------|-------------|
| Size | 1-500 MB | Amount of memory to allocate |

### Button Actions

- **Allocate Memory** - Creates a new memory allocation
- **Release** (per allocation) - Frees specific allocation
- **Release All** - Frees all allocations

### Stacking Behavior

Multiple allocations can coexist:
- Allocate 100MB → Total: 100MB
- Allocate 200MB → Total: 300MB  
- Release first → Total: 200MB

This mimics real-world memory leak progression.

## Expected Effects

### Metrics

| Metric | Expected Change | Why |
|--------|-----------------|-----|
| Heap Memory | Increases by allocation size | Buffers stored on heap |
| RSS Memory | Increases proportionally | Physical memory committed |
| Event Loop Lag | Brief spikes during allocation | GC pauses |
| CPU | Spikes during allocation | Buffer filling |

### Memory Thresholds

| Heap Usage | Behavior |
|------------|----------|
| < 50% | Normal operation |
| 50-75% | Increased GC frequency |
| 75-90% | Aggressive GC, longer pauses |
| > 90% | Risk of OOM, severe GC pressure |

### Dashboard Behavior

- Memory tile value increases
- Memory bar shows proportion of available
- RSS tile shows physical memory growth
- Active Simulations shows each allocation with size

## Node.js Memory Characteristics

### Heap vs RSS

| Metric | What It Measures | Typical Range |
|--------|------------------|---------------|
| **Heap Used** | JavaScript objects, strings, buffers | 20MB - heap limit |
| **Heap Total** | Allocated heap space (may exceed used) | Up to `--max-old-space-size` |
| **RSS** | Total physical memory (heap + stack + code + buffers) | Heap + 50-100MB overhead |
| **External** | Memory held by C++ objects (Buffers allocated outside V8) | Varies |

### V8 Garbage Collection

Node.js uses generational GC:

1. **Scavenge (Minor GC)** - Collects short-lived objects, fast (~1-10ms)
2. **Mark-Sweep (Major GC)** - Full heap scan, slower (~10-100ms+)
3. **Mark-Compact** - Defragments heap, can cause noticeable pauses

**Visible symptoms:**
- Event loop lag spikes correspond to GC pauses
- Saw-tooth memory pattern (allocate → GC → allocate)
- Higher heap usage = longer GC pauses

### Default Limits

| Environment | Default Heap Limit |
|-------------|-------------------|
| 64-bit Node.js | ~1.5 GB |
| 32-bit Node.js | ~512 MB |
| Azure App Service | Varies by SKU |

Override with: `node --max-old-space-size=4096 app.js` (4GB)

## Diagnostic Workflow

### 1. Baseline Memory

Note current values:
- Heap Used
- RSS Memory
- Event Loop Lag

### 2. Allocate Memory

Multiple allocations to simulate leak:
```bash
# First allocation
curl -X POST http://localhost:3000/api/simulations/memory \
  -H "Content-Type: application/json" \
  -d '{"sizeMb": 100}'
# Returns: {"id": "mem_abc123", ...}

# Second allocation  
curl -X POST http://localhost:3000/api/simulations/memory \
  -H "Content-Type: application/json" \
  -d '{"sizeMb": 100}'
# Returns: {"id": "mem_def456", ...}
```

### 3. Observe Effects

**Dashboard:**
- Memory tiles show cumulative growth
- Event loop may show GC pause spikes

**Linux Tools:**
```bash
# Node.js memory usage
node -e "console.log(process.memoryUsage())"

# Process memory from OS view
ps aux | grep node
# RSS column shows physical memory in KB

# Detailed memory map
cat /proc/$(pgrep -f "node dist/index")/status | grep -i mem
```

### 4. Release Memory

```bash
# Release specific allocation
curl -X DELETE http://localhost:3000/api/simulations/memory/mem_abc123

# Or release all via dashboard
```

### 5. Verify Recovery

- Heap should decrease (after GC)
- RSS may remain elevated (OS memory behavior)
- Event loop lag returns to baseline

## API Reference

### Allocate Memory

```http
POST /api/simulations/memory
Content-Type: application/json

{
  "sizeMb": 100
}
```

**Response:**
```json
{
  "id": "mem_abc123",
  "type": "MEMORY_PRESSURE",
  "status": "ACTIVE",
  "parameters": {
    "sizeMb": 100
  },
  "startTime": "2026-02-10T20:00:00.000Z"
}
```

### Release Memory

```http
DELETE /api/simulations/memory/{id}
```

### List Allocations

```http
GET /api/simulations
```

## Azure Diagnostics

### App Service Diagnostics

1. **Diagnose and solve problems** → **Memory**
2. Look for:
   - Memory growth over time
   - Memory not releasing after load decreases
   - GC patterns

### Application Insights

```kusto
// Memory usage over time
performanceCounters
| where name contains "Private Bytes" or name contains "Working Set"
| summarize avg(value) by bin(timestamp, 1m), name
| render timechart

// Node.js heap specifically
customMetrics
| where name == "nodejs.heap_used_bytes"
| summarize avg(value) by bin(timestamp, 1m)
```

### Taking Heap Snapshots (Advanced)

Via Kudu SSH:
```bash
# Connect with inspector
node --inspect dist/index.js

# Then use Chrome DevTools:
# chrome://inspect → Click "inspect" → Memory tab → Take snapshot
```

## Troubleshooting

### Memory doesn't release

1. **GC hasn't run yet** - Wait or force GC (dev only): `global.gc()`
2. **References still held** - Check simulation tracker shows allocation removed
3. **RSS stays high** - Normal OS behavior; memory pages may remain allocated

### Allocation fails

1. **Near heap limit** - Release existing allocations first
2. **Exceeds MAX_MEMORY_ALLOCATION_MB** - Configure higher limit
3. **Azure limits** - Check App Service SKU memory limits

### OOM Crash

If heap limit exceeded:
- Process crashes with "JavaScript heap out of memory"
- Azure App Service auto-restarts
- Consider increasing `--max-old-space-size`
