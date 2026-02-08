# Memory Pressure Simulation Guide

## Overview

The memory pressure simulation allocates and retains memory buffers to simulate memory leaks or high memory usage scenarios. Unlike other simulations, memory allocations persist until explicitly released.

## How It Works

The simulation uses `Buffer.alloc()` to allocate memory:

1. Creates a Buffer of the specified size
2. Stores a reference to prevent garbage collection
3. Memory remains allocated until `DELETE` is called
4. Multiple allocations can coexist (stacking)

## API Usage

### Allocate Memory

```bash
POST /api/simulations/memory
Content-Type: application/json

{
  "sizeMb": 100
}
```

**Parameters:**
- `sizeMb` (1-500): Memory to allocate in megabytes

**Response:**
```json
{
  "id": "uuid-of-allocation",
  "type": "MEMORY_PRESSURE",
  "message": "Allocated 100MB of memory",
  "totalAllocatedMb": 100
}
```

### Release Memory

```bash
DELETE /api/simulations/memory/{id}
```

**Response:**
```json
{
  "id": "uuid-of-allocation",
  "type": "MEMORY_PRESSURE",
  "message": "Released 100MB of memory",
  "totalAllocatedMb": 0
}
```

### List Active Allocations

```bash
GET /api/simulations/memory
```

## Memory Metrics

The dashboard displays several memory metrics:

| Metric | Description |
|--------|-------------|
| Heap Used | V8 JavaScript heap memory in use |
| Heap Total | Total V8 heap memory allocated |
| RSS | Resident Set Size - total process memory |
| External | C++ object memory bound to JS |

Buffer allocations appear in RSS and External (not Heap) since Buffers use native memory.

## Diagnostic Exercises

### Exercise 1: Observe Memory Growth

1. Note baseline RSS memory
2. Allocate 100MB multiple times
3. Watch RSS increase in dashboard
4. Release allocations
5. Observe RSS decrease (may take time for GC)

### Exercise 2: Heap Snapshot Analysis

1. Start application with `--expose-gc` flag
2. Allocate memory
3. Take heap snapshot using Chrome DevTools
4. Analyze memory distribution
5. Compare snapshots before and after

### Exercise 3: Memory Limits

1. Set Node.js memory limit:
   ```bash
   node --max-old-space-size=512 dist/index.js
   ```
2. Allocate memory approaching limit
3. Observe behavior near limit
4. Test OOM trigger

## Expected Observations

| Metric | Expected Behavior |
|--------|-------------------|
| RSS Memory | Increases by allocation size |
| Heap Used | Minor or no change (Buffers use native memory) |
| External | Increases by allocation size |
| CPU | No significant change during allocation |

## Memory Release Behavior

When memory is released:

1. Reference is removed from tracking Map
2. Buffer becomes eligible for garbage collection
3. GC runs at V8's discretion (not immediately)
4. RSS may not decrease immediately

To force garbage collection (development only):
```bash
node --expose-gc dist/index.js
# Then call global.gc() in code
```

## Best Practices

1. **Track allocation IDs** - You need them to release memory
2. **Monitor total allocated** - API returns totalAllocatedMb
3. **Consider system memory** - Don't exceed available RAM
4. **Watch for swap usage** - Indicates memory pressure beyond RAM
