/**
 * Simulation Tracker Service Unit Tests
 */

import { SimulationTrackerService } from '../../../src/services/simulation-tracker.service';

describe('SimulationTrackerService', () => {
  beforeEach(() => {
    SimulationTrackerService.clear();
  });

  afterAll(() => {
    SimulationTrackerService.clear();
  });

  describe('createSimulation', () => {
    it('should create a simulation with correct properties', () => {
      const simulation = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 30 },
        30
      );

      expect(simulation.id).toBeDefined();
      expect(simulation.type).toBe('CPU_STRESS');
      expect(simulation.status).toBe('ACTIVE');
      expect(simulation.startedAt).toBeInstanceOf(Date);
      expect(simulation.stoppedAt).toBeNull();
      expect(simulation.scheduledEndAt).toBeInstanceOf(Date);
    });

    it('should generate unique IDs for each simulation', () => {
      const sim1 = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 10 },
        10
      );
      const sim2 = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 10 },
        10
      );

      expect(sim1.id).not.toBe(sim2.id);
    });
  });

  describe('getSimulation', () => {
    it('should return simulation by ID', () => {
      const created = SimulationTrackerService.createSimulation(
        'MEMORY_PRESSURE',
        { type: 'MEMORY_PRESSURE', sizeMb: 100 },
        60
      );

      const retrieved = SimulationTrackerService.getSimulation(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent ID', () => {
      const result = SimulationTrackerService.getSimulation('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getActiveSimulations', () => {
    it('should return only active simulations', () => {
      const sim1 = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );
      const sim2 = SimulationTrackerService.createSimulation(
        'MEMORY_PRESSURE',
        { type: 'MEMORY_PRESSURE', sizeMb: 100 },
        60
      );

      SimulationTrackerService.stopSimulation(sim1.id);

      const active = SimulationTrackerService.getActiveSimulations();

      expect(active.length).toBe(1);
      expect(active[0].id).toBe(sim2.id);
    });
  });

  describe('getActiveSimulationsByType', () => {
    it('should filter by simulation type', () => {
      SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );
      SimulationTrackerService.createSimulation(
        'MEMORY_PRESSURE',
        { type: 'MEMORY_PRESSURE', sizeMb: 100 },
        60
      );
      SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 70, durationSeconds: 60 },
        60
      );

      const cpuSimulations = SimulationTrackerService.getActiveSimulationsByType('CPU_STRESS');

      expect(cpuSimulations.length).toBe(2);
      cpuSimulations.forEach((sim) => {
        expect(sim.type).toBe('CPU_STRESS');
      });
    });
  });

  describe('stopSimulation', () => {
    it('should update status to STOPPED', () => {
      const simulation = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );

      const stopped = SimulationTrackerService.stopSimulation(simulation.id);

      expect(stopped?.status).toBe('STOPPED');
      expect(stopped?.stoppedAt).toBeInstanceOf(Date);
    });

    it('should return undefined for already stopped simulation', () => {
      const simulation = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );

      SimulationTrackerService.stopSimulation(simulation.id);
      const result = SimulationTrackerService.stopSimulation(simulation.id);

      expect(result).toBeUndefined();
    });
  });

  describe('completeSimulation', () => {
    it('should update status to COMPLETED', () => {
      const simulation = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );

      const completed = SimulationTrackerService.completeSimulation(simulation.id);

      expect(completed?.status).toBe('COMPLETED');
    });
  });

  describe('failSimulation', () => {
    it('should update status to FAILED', () => {
      const simulation = SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );

      const failed = SimulationTrackerService.failSimulation(simulation.id);

      expect(failed?.status).toBe('FAILED');
    });
  });

  describe('getActiveCount', () => {
    it('should return correct count', () => {
      expect(SimulationTrackerService.getActiveCount()).toBe(0);

      SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );

      expect(SimulationTrackerService.getActiveCount()).toBe(1);

      SimulationTrackerService.createSimulation(
        'MEMORY_PRESSURE',
        { type: 'MEMORY_PRESSURE', sizeMb: 100 },
        60
      );

      expect(SimulationTrackerService.getActiveCount()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all simulations', () => {
      SimulationTrackerService.createSimulation(
        'CPU_STRESS',
        { type: 'CPU_STRESS', targetLoadPercent: 50, durationSeconds: 60 },
        60
      );
      SimulationTrackerService.createSimulation(
        'MEMORY_PRESSURE',
        { type: 'MEMORY_PRESSURE', sizeMb: 100 },
        60
      );

      expect(SimulationTrackerService.getActiveCount()).toBe(2);

      SimulationTrackerService.clear();

      expect(SimulationTrackerService.getActiveCount()).toBe(0);
    });
  });
});
