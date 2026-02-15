/**
 * =============================================================================
 * MEMORY PRESSURE SERVICE — Heap Memory Allocation Simulation
 * =============================================================================
 *
 * PURPOSE:
 *   Simulates memory pressure by allocating and retaining objects on the managed
 *   heap. Memory is held until explicitly released by the user via the DELETE
 *   endpoint. This makes memory usage visible in application metrics and
 *   Azure App Service monitoring.
 *
 * HOW IT WORKS:
 *   1. Allocate small JS objects (~210 bytes each) in an array
 *   2. ~4800 objects = ~1MB of V8 heap memory
 *   3. Allocation is done in batches (10k objects per batch) via setImmediate
 *      to avoid blocking the event loop during large allocations
 *   4. Objects stay referenced (preventing GC) until release() is called
 *   5. On release: clear array, dereferenced objects become eligible for GC
 *   6. If --expose-gc flag is set, force GC runs immediately after release
 *
 * WHY HEAP OBJECTS (NOT BUFFERS):
 *   Buffer.alloc() creates native (C++) memory outside the V8 heap.
 *   It shows in RSS but NOT in heapUsed. For this training tool, we want
 *   heap-visible memory pressure that triggers GC pauses and shows in
 *   V8/managed memory metrics.
 *
 * PORTING NOTES:
 *   The goal is to allocate MANAGED HEAP objects that are visible in the
 *   runtime's memory metrics and trigger garbage collection pressure:
 *   - Java: ArrayList<byte[]> with byte[1024] chunks. Shows in Runtime.totalMemory().
 *   - Python: List of dict objects. Shows in sys.getsizeof() and tracemalloc.
 *   - C#: List<byte[]> with byte[1024] chunks. Shows in GC.GetTotalMemory().
 *   - PHP: Array of stdClass objects. Shows in memory_get_usage().
 *
 *   KEY BEHAVIORS TO REPLICATE:
 *   a) Memory does NOT auto-expire — must be explicitly released
 *   b) Allocation is incremental (batched) to avoid blocking during large allocs
 *   c) Release triggers immediate GC if possible
 *   d) Multiple independent allocations can coexist (tracked by simulation ID)
 *
 * @module services/memory-pressure
 */

import { Simulation, MemoryPressureParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';

/** Memory allocation entry with data and size tracking */
interface MemoryAllocation {
  data: object[];
  sizeMb: number;
}

/** Active memory allocations by simulation ID */
const allocations: Map<string, MemoryAllocation> = new Map();

/**
 * Memory Pressure Service
 *
 * ALLOCATION TRACKING:
 * - allocations Map<simulationId, { data: object[], sizeMb: number }>
 * - Each entry holds the actual object references (preventing GC)
 * - sizeMb records the requested size for reporting
 *
 * LIFECYCLE:
 * - allocate(): Creates simulation, starts async batch allocation
 * - release(): Clears array, deletes from map, forces GC, stops simulation
 */
class MemoryPressureServiceClass {
  /**
   * Allocates memory and starts a memory pressure simulation.
   *
   * ALLOCATION ALGORITHM:
   * 1. Create simulation record (no auto-expiry for memory allocations)
   * 2. Calculate total objects needed: sizeMb * 4800 objects/MB
   * 3. Allocate in batches of 10k objects using setImmediate between batches
   * 4. Each object has properties to ensure it takes ~210 bytes on the heap
   * 5. Log MEMORY_ALLOCATING immediately, MEMORY_ALLOCATED when complete
   *
   * The async batching via setImmediate prevents the allocation from blocking
   * the event loop, which would freeze the dashboard during large allocations.
   *
   * @param params - Memory pressure parameters (sizeMb)
   * @returns The created simulation record
   */
  allocate(params: MemoryPressureParams): Simulation {
    const { sizeMb } = params;

    // Create simulation record (no auto-expiry for memory allocations)
    const simulation = SimulationTrackerService.createSimulation(
      'MEMORY_PRESSURE',
      { type: 'MEMORY_PRESSURE', sizeMb },
      // Memory allocations don't auto-expire - max duration is effectively infinite
      Number.MAX_SAFE_INTEGER / 1000
    );

    // Initialize allocation immediately so it shows up
    const data: object[] = [];
    allocations.set(simulation.id, { data, sizeMb });

    // Log the start
    EventLogService.info('MEMORY_ALLOCATING', `Starting allocation of ${sizeMb}MB...`, {
      simulationId: simulation.id,
      simulationType: 'MEMORY_PRESSURE',
      details: { sizeMb },
    });

    // Allocate asynchronously in batches to avoid blocking the event loop
    // Calibrated: ~4800 objects = ~1MB of V8 heap (each object ~210 bytes with properties + overhead)
    const objectsPerMb = 4800;
    const totalObjects = sizeMb * objectsPerMb;
    const batchSize = 10000; // Allocate 10k objects per batch (~2MB)
    let allocated = 0;

    const allocateBatch = () => {
      const allocation = allocations.get(simulation.id);
      if (!allocation) {
        // Allocation was released before completion
        return;
      }

      const end = Math.min(allocated + batchSize, totalObjects);
      for (let i = allocated; i < end; i++) {
        allocation.data.push({ 
          id: i, 
          timestamp: Date.now(), 
          random: Math.random(),
          payload: `data-${i}-${Math.random().toString(36)}`
        });
      }
      allocated = end;

      if (allocated < totalObjects) {
        // Continue allocation on next tick
        setImmediate(allocateBatch);
      } else {
        // Allocation complete
        EventLogService.info('MEMORY_ALLOCATED', `Allocated ${sizeMb}MB of heap memory (${totalObjects} objects)`, {
          simulationId: simulation.id,
          simulationType: 'MEMORY_PRESSURE',
          details: { sizeMb, objects: totalObjects },
        });
      }
    };

    // Start the async allocation
    setImmediate(allocateBatch);

    return simulation;
  }

  /**
   * Releases a memory allocation and triggers garbage collection.
   *
   * RELEASE ALGORITHM:
   * 1. Clear the data array (data.length = 0) to dereference all objects
   * 2. Delete the allocation entry from the map
   * 3. Force GC twice if --expose-gc flag is set (global.gc())
   * 4. Update simulation status to STOPPED
   * 5. Log MEMORY_RELEASED event
   *
   * The double GC call helps ensure the memory is reclaimed promptly.
   * Without --expose-gc, GC happens at the V8 engine's discretion.
   *
   * PORTING NOTES:
   *   - Java: Clear the ArrayList, then System.gc() (advisory only)
   *   - Python: Clear the list, then gc.collect()
   *   - C#: Clear the list, then GC.Collect() + GC.WaitForPendingFinalizers()
   *
   * @param id - Simulation/allocation ID
   * @returns Release info including size freed, or undefined if nothing found
   */
  release(id: string): { simulation?: Simulation; sizeMb: number; wasAllocated: boolean } | undefined {
    const allocation = allocations.get(id);
    
    // Get size before deleting
    const sizeMb = allocation?.sizeMb ?? 0;
    const wasAllocated = !!allocation;

    // Delete the allocation if it exists
    if (allocation) {
      // Clear the data array to release object references
      allocation.data.length = 0;
      allocations.delete(id);
      
      // Force garbage collection if available (requires --expose-gc flag)
      // Run GC synchronously and multiple times to ensure memory is reclaimed
      if (typeof global.gc === 'function') {
        console.log('[MemoryPressure] Running garbage collection...');
        global.gc();
        global.gc();  // Run twice for good measure
      } else {
        console.log('[MemoryPressure] GC not exposed - run with --expose-gc flag');
      }
    }

    // Stop the simulation tracking
    const simulation = SimulationTrackerService.stopSimulation(id);

    // If neither existed, return undefined
    if (!wasAllocated && !simulation) {
      return undefined;
    }

    // Log the release
    EventLogService.info('MEMORY_RELEASED', `Released ${sizeMb}MB of heap memory`, {
      simulationId: id,
      simulationType: 'MEMORY_PRESSURE',
      details: { sizeMb, wasAllocated, hadSimulation: !!simulation },
    });

    return { simulation, sizeMb, wasAllocated };
  }

  /**
   * Gets all active memory allocations.
   *
   * @returns Array of active memory pressure simulations
   */
  getActiveAllocations(): Simulation[] {
    return SimulationTrackerService.getActiveSimulationsByType('MEMORY_PRESSURE');
  }

  /**
   * Gets the total allocated memory in MB.
   *
   * @returns Total allocated memory in megabytes
   */
  getTotalAllocatedMb(): number {
    let total = 0;
    for (const allocation of allocations.values()) {
      total += allocation.sizeMb;
    }
    return total;
  }

  /**
   * Gets allocation info for a specific simulation.
   *
   * @param id - Simulation ID
   * @returns Allocation size in MB or undefined if not found
   */
  getAllocationSize(id: string): number | undefined {
    const allocation = allocations.get(id);
    return allocation ? allocation.sizeMb : undefined;
  }

  /**
   * Releases all memory allocations.
   */
  releaseAll(): void {
    const activeAllocations = this.getActiveAllocations();
    for (const allocation of activeAllocations) {
      this.release(allocation.id);
    }
  }

  /**
   * Gets the count of active allocations.
   *
   * @returns Number of active allocations
   */
  getActiveCount(): number {
    return allocations.size;
  }
}

/**
 * Singleton instance of the MemoryPressureService.
 */
export const MemoryPressureService = new MemoryPressureServiceClass();
