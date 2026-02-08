/**
 * Memory Pressure Service
 *
 * Simulates memory pressure by allocating and retaining buffers.
 *
 * @module services/memory-pressure
 */

import { Simulation, MemoryPressureParams } from '../types';
import { SimulationTrackerService } from './simulation-tracker.service';
import { EventLogService } from './event-log.service';
import { mbToBytes, bytesToMb } from '../utils';

/** Active memory allocations by simulation ID */
const allocations: Map<string, Buffer> = new Map();

/**
 * Memory Pressure Service
 *
 * Uses Buffer.alloc to create memory pressure with explicit tracking.
 */
class MemoryPressureServiceClass {
  /**
   * Allocates memory and starts a memory pressure simulation.
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

    try {
      // Allocate the buffer
      const sizeBytes = mbToBytes(sizeMb);
      const buffer = Buffer.alloc(sizeBytes);

      // Store the allocation
      allocations.set(simulation.id, buffer);

      // Log the allocation
      EventLogService.info('MEMORY_ALLOCATED', `Allocated ${sizeMb}MB of memory`, {
        simulationId: simulation.id,
        simulationType: 'MEMORY_PRESSURE',
        details: { sizeMb, sizeBytes },
      });

      return simulation;
    } catch (error) {
      // Allocation failed - mark simulation as failed
      SimulationTrackerService.failSimulation(simulation.id);
      EventLogService.error(
        'SIMULATION_FAILED',
        `Failed to allocate ${sizeMb}MB: ${(error as Error).message}`,
        {
          simulationId: simulation.id,
          simulationType: 'MEMORY_PRESSURE',
        }
      );
      throw error;
    }
  }

  /**
   * Releases a memory allocation.
   *
   * @param id - Simulation/allocation ID
   * @returns The stopped simulation or undefined if not found
   */
  release(id: string): Simulation | undefined {
    const buffer = allocations.get(id);
    if (!buffer) {
      return undefined;
    }

    // Get size before deleting
    const sizeMb = bytesToMb(buffer.length);

    // Delete the allocation (allows GC to reclaim)
    allocations.delete(id);

    // Stop the simulation
    const simulation = SimulationTrackerService.stopSimulation(id);

    if (simulation) {
      EventLogService.info('MEMORY_RELEASED', `Released ${sizeMb}MB of memory`, {
        simulationId: id,
        simulationType: 'MEMORY_PRESSURE',
        details: { sizeMb },
      });
    }

    return simulation;
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
    for (const buffer of allocations.values()) {
      total += buffer.length;
    }
    return bytesToMb(total);
  }

  /**
   * Gets allocation info for a specific simulation.
   *
   * @param id - Simulation ID
   * @returns Allocation size in MB or undefined if not found
   */
  getAllocationSize(id: string): number | undefined {
    const buffer = allocations.get(id);
    return buffer ? bytesToMb(buffer.length) : undefined;
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
