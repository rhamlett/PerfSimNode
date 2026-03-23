/**
 * Memory Pressure Service Unit Tests
 */

import { MemoryPressureService } from '../../../src/services/memory-pressure.service';
import { SimulationTrackerService } from '../../../src/services/simulation-tracker.service';

describe('MemoryPressureService', () => {
  beforeEach(() => {
    SimulationTrackerService.clear();
    MemoryPressureService.releaseAll();
  });

  afterAll(() => {
    MemoryPressureService.releaseAll();
  });

  describe('allocate', () => {
    it('should allocate memory and create simulation', () => {
      const simulation = MemoryPressureService.allocate({ sizeMb: 10 });

      expect(simulation).toBeDefined();
      expect(simulation.id).toBeDefined();
      expect(simulation.type).toBe('MEMORY_PRESSURE');
      expect(simulation.status).toBe('ACTIVE');

      // Cleanup
      MemoryPressureService.release(simulation.id);
    });

    it('should track total allocated memory', () => {
      const sim1 = MemoryPressureService.allocate({ sizeMb: 10 });
      expect(MemoryPressureService.getTotalAllocatedMb()).toBeCloseTo(10, 0);

      const sim2 = MemoryPressureService.allocate({ sizeMb: 20 });
      expect(MemoryPressureService.getTotalAllocatedMb()).toBeCloseTo(30, 0);

      // Cleanup
      MemoryPressureService.release(sim1.id);
      MemoryPressureService.release(sim2.id);
    });
  });

  describe('release', () => {
    it('should release allocated memory', () => {
      const simulation = MemoryPressureService.allocate({ sizeMb: 10 });

      const totalBefore = MemoryPressureService.getTotalAllocatedMb();
      expect(totalBefore).toBeGreaterThan(0);

      const released = MemoryPressureService.release(simulation.id);

      expect(released).toBeDefined();
      expect(released?.simulation?.status).toBe('STOPPED');
      expect(MemoryPressureService.getTotalAllocatedMb()).toBe(0);
    });

    it('should return undefined for non-existent allocation', () => {
      const result = MemoryPressureService.release('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getActiveAllocations', () => {
    it('should return all active memory allocations', () => {
      const sim1 = MemoryPressureService.allocate({ sizeMb: 10 });
      const sim2 = MemoryPressureService.allocate({ sizeMb: 20 });

      const allocations = MemoryPressureService.getActiveAllocations();

      expect(allocations.length).toBe(2);
      expect(allocations.some((a) => a.id === sim1.id)).toBe(true);
      expect(allocations.some((a) => a.id === sim2.id)).toBe(true);

      // Cleanup
      MemoryPressureService.releaseAll();
    });
  });

  describe('getAllocationSize', () => {
    it('should return allocation size for valid ID', () => {
      const simulation = MemoryPressureService.allocate({ sizeMb: 50 });

      const size = MemoryPressureService.getAllocationSize(simulation.id);

      expect(size).toBeCloseTo(50, 0);

      // Cleanup
      MemoryPressureService.release(simulation.id);
    });

    it('should return undefined for non-existent ID', () => {
      const size = MemoryPressureService.getAllocationSize('non-existent');
      expect(size).toBeUndefined();
    });
  });

  describe('releaseAll', () => {
    it('should release all allocations', () => {
      MemoryPressureService.allocate({ sizeMb: 10 });
      MemoryPressureService.allocate({ sizeMb: 20 });
      MemoryPressureService.allocate({ sizeMb: 30 });

      expect(MemoryPressureService.getActiveCount()).toBe(3);

      MemoryPressureService.releaseAll();

      expect(MemoryPressureService.getActiveCount()).toBe(0);
      expect(MemoryPressureService.getTotalAllocatedMb()).toBe(0);
    });
  });

  describe('getActiveCount', () => {
    it('should return correct count', () => {
      expect(MemoryPressureService.getActiveCount()).toBe(0);

      const sim1 = MemoryPressureService.allocate({ sizeMb: 10 });
      expect(MemoryPressureService.getActiveCount()).toBe(1);

      const sim2 = MemoryPressureService.allocate({ sizeMb: 10 });
      expect(MemoryPressureService.getActiveCount()).toBe(2);

      MemoryPressureService.release(sim1.id);
      expect(MemoryPressureService.getActiveCount()).toBe(1);

      MemoryPressureService.release(sim2.id);
      expect(MemoryPressureService.getActiveCount()).toBe(0);
    });
  });
});
