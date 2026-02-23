/**
 * CPU Stress Service Unit Tests
 */

import { CpuStressService } from '../../../src/services/cpu-stress.service';
import { SimulationTrackerService } from '../../../src/services/simulation-tracker.service';

describe('CpuStressService', () => {
  beforeEach(() => {
    // Clear all simulations before each test
    SimulationTrackerService.clear();
    CpuStressService.stopAll();
  });

  afterAll(() => {
    // Cleanup after all tests
    CpuStressService.stopAll();
  });

  describe('start', () => {
    it('should create a CPU stress simulation', () => {
      const simulation = CpuStressService.start({
        intensity: 'moderate',
        durationSeconds: 5,
      });

      expect(simulation).toBeDefined();
      expect(simulation.id).toBeDefined();
      expect(simulation.type).toBe('CPU_STRESS');
      expect(simulation.status).toBe('ACTIVE');
      expect(simulation.parameters).toEqual({
        type: 'CPU_STRESS',
        intensity: 'moderate',
        durationSeconds: 5,
      });

      // Cleanup
      CpuStressService.stop(simulation.id);
    });

    it('should allow multiple concurrent simulations', () => {
      const sim1 = CpuStressService.start({ intensity: 'moderate', durationSeconds: 5 });
      const sim2 = CpuStressService.start({ intensity: 'high', durationSeconds: 5 });

      expect(sim1.id).not.toBe(sim2.id);
      expect(CpuStressService.getActiveSimulations().length).toBe(2);

      // Cleanup
      CpuStressService.stopAll();
    });
  });

  describe('stop', () => {
    it('should stop an active simulation', () => {
      const simulation = CpuStressService.start({
        intensity: 'moderate',
        durationSeconds: 60,
      });

      const stopped = CpuStressService.stop(simulation.id);

      expect(stopped).toBeDefined();
      expect(stopped?.status).toBe('STOPPED');
      expect(stopped?.stoppedAt).toBeInstanceOf(Date);
    });

    it('should return undefined for non-existent simulation', () => {
      const result = CpuStressService.stop('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getActiveSimulations', () => {
    it('should return empty array when no simulations active', () => {
      expect(CpuStressService.getActiveSimulations()).toEqual([]);
    });

    it('should return only CPU stress simulations', () => {
      const sim = CpuStressService.start({ intensity: 'moderate', durationSeconds: 5 });

      const active = CpuStressService.getActiveSimulations();

      expect(active.length).toBe(1);
      expect(active[0].type).toBe('CPU_STRESS');

      // Cleanup
      CpuStressService.stop(sim.id);
    });
  });

  describe('hasActiveSimulations', () => {
    it('should return false when no simulations active', () => {
      expect(CpuStressService.hasActiveSimulations()).toBe(false);
    });

    it('should return true when simulation is active', () => {
      const sim = CpuStressService.start({ intensity: 'moderate', durationSeconds: 5 });

      expect(CpuStressService.hasActiveSimulations()).toBe(true);

      CpuStressService.stop(sim.id);

      expect(CpuStressService.hasActiveSimulations()).toBe(false);
    });
  });

  describe('stopAll', () => {
    it('should stop all active CPU simulations', () => {
      CpuStressService.start({ intensity: 'moderate', durationSeconds: 60 });
      CpuStressService.start({ intensity: 'high', durationSeconds: 60 });
      CpuStressService.start({ intensity: 'moderate', durationSeconds: 60 });

      expect(CpuStressService.getActiveSimulations().length).toBe(3);

      CpuStressService.stopAll();

      expect(CpuStressService.getActiveSimulations().length).toBe(0);
    });
  });
});
