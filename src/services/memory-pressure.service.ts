/**
 * Memory Pressure Service
 *
 * Simulates memory pressure by allocating and retaining V8 heap memory.
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
 * Uses object arrays to create memory pressure in V8 heap.
 */
class MemoryPressureServiceClass {
  /**
   * Allocates memory and starts a memory pressure simulation.
   * Allocation happens asynchronously to avoid blocking the event loop.
   *
   * @param params - Memory pressure parameters
   * @returns The created simulation
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
   * Releases a memory allocation.
   *
   * @param id - Simulation/allocation ID
   * @returns Object with release info, or undefined if nothing was found to release
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
