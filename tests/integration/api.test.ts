/**
 * API Integration Tests
 */

import request from 'supertest';
import { createApp } from '../../src/app';
import { SimulationTrackerService } from '../../src/services/simulation-tracker.service';
import { CpuStressService } from '../../src/services/cpu-stress.service';
import { MemoryPressureService } from '../../src/services/memory-pressure.service';

const app = createApp();

describe('API Integration Tests', () => {
  beforeEach(() => {
    // Clean up before each test
    SimulationTrackerService.clear();
    CpuStressService.stopAll();
    MemoryPressureService.releaseAll();
  });

  afterAll(() => {
    // Final cleanup
    CpuStressService.stopAll();
    MemoryPressureService.releaseAll();
    SimulationTrackerService.clear();
  });

  describe('GET /api/health', () => {
    it('should return healthy status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeGreaterThan(0);
      expect(response.body.version).toBe('1.0.0');
    });
  });

  describe('GET /api/metrics', () => {
    it('should return system metrics', async () => {
      const response = await request(app).get('/api/metrics');

      expect(response.status).toBe(200);
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.cpu).toBeDefined();
      expect(response.body.memory).toBeDefined();
      expect(response.body.eventLoop).toBeDefined();
      expect(response.body.process).toBeDefined();
    });

    it('should return valid CPU metrics', async () => {
      const response = await request(app).get('/api/metrics');

      expect(response.body.cpu.usagePercent).toBeGreaterThanOrEqual(0);
      expect(response.body.cpu.usagePercent).toBeLessThanOrEqual(100);
    });

    it('should return valid memory metrics', async () => {
      const response = await request(app).get('/api/metrics');

      expect(response.body.memory.heapUsedMb).toBeGreaterThan(0);
      expect(response.body.memory.rssMb).toBeGreaterThan(0);
    });
  });

  describe('POST /api/simulations/cpu', () => {
    it('should start CPU stress simulation with valid parameters', async () => {
      const response = await request(app)
        .post('/api/simulations/cpu')
        .send({ targetLoadPercent: 50, durationSeconds: 5 });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.type).toBe('CPU_STRESS');
      expect(response.body.message).toContain('50%');

      // Cleanup
      await request(app).delete(`/api/simulations/cpu/${response.body.id}`);
    });

    it('should reject invalid targetLoadPercent', async () => {
      const response = await request(app)
        .post('/api/simulations/cpu')
        .send({ targetLoadPercent: 150, durationSeconds: 10 });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject invalid durationSeconds', async () => {
      const response = await request(app)
        .post('/api/simulations/cpu')
        .send({ targetLoadPercent: 50, durationSeconds: 500 });

      expect(response.status).toBe(400);
    });

    it('should reject missing parameters', async () => {
      const response = await request(app).post('/api/simulations/cpu').send({});

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/simulations/cpu/:id', () => {
    it('should stop running simulation', async () => {
      // Start a simulation
      const startResponse = await request(app)
        .post('/api/simulations/cpu')
        .send({ targetLoadPercent: 50, durationSeconds: 60 });

      const id = startResponse.body.id;

      // Stop it
      const stopResponse = await request(app).delete(`/api/simulations/cpu/${id}`);

      expect(stopResponse.status).toBe(200);
      expect(stopResponse.body.status).toBe('STOPPED');
    });

    it('should return 404 for non-existent simulation', async () => {
      const response = await request(app).delete(
        '/api/simulations/cpu/00000000-0000-0000-0000-000000000000'
      );

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await request(app).delete('/api/simulations/cpu/invalid-uuid');

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/simulations/memory', () => {
    it('should allocate memory with valid parameters', async () => {
      const response = await request(app)
        .post('/api/simulations/memory')
        .send({ sizeMb: 10 });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.type).toBe('MEMORY_PRESSURE');
      expect(response.body.totalAllocatedMb).toBeGreaterThan(0);

      // Cleanup
      await request(app).delete(`/api/simulations/memory/${response.body.id}`);
    });

    it('should reject size exceeding limit', async () => {
      const response = await request(app)
        .post('/api/simulations/memory')
        .send({ sizeMb: 1000 });

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/simulations/memory/:id', () => {
    it('should release allocated memory', async () => {
      // Allocate
      const allocResponse = await request(app)
        .post('/api/simulations/memory')
        .send({ sizeMb: 10 });

      const id = allocResponse.body.id;

      // Release
      const releaseResponse = await request(app).delete(`/api/simulations/memory/${id}`);

      expect(releaseResponse.status).toBe(200);
      expect(releaseResponse.body.status).toBe('STOPPED');
    });
  });

  describe('GET /api/simulations', () => {
    it('should return empty list when no active simulations', async () => {
      const response = await request(app).get('/api/simulations');

      expect(response.status).toBe(200);
      expect(response.body.simulations).toEqual([]);
      expect(response.body.count).toBe(0);
    });

    it('should list all active simulations', async () => {
      // Start some simulations
      const cpuResponse = await request(app)
        .post('/api/simulations/cpu')
        .send({ targetLoadPercent: 30, durationSeconds: 60 });

      const memResponse = await request(app)
        .post('/api/simulations/memory')
        .send({ sizeMb: 10 });

      // List
      const listResponse = await request(app).get('/api/simulations');

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.count).toBe(2);

      // Cleanup
      await request(app).delete(`/api/simulations/cpu/${cpuResponse.body.id}`);
      await request(app).delete(`/api/simulations/memory/${memResponse.body.id}`);
    });
  });

  describe('GET /api/admin/status', () => {
    it('should return admin status', async () => {
      const response = await request(app).get('/api/admin/status');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.config).toBeDefined();
      expect(response.body.activeSimulations).toBeDefined();
      expect(response.body.metrics).toBeDefined();
    });
  });

  describe('GET /api/admin/events', () => {
    it('should return event log', async () => {
      const response = await request(app).get('/api/admin/events');

      expect(response.status).toBe(200);
      expect(response.body.events).toBeDefined();
      expect(Array.isArray(response.body.events)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app).get('/api/admin/events?limit=5');

      expect(response.status).toBe(200);
      expect(response.body.events.length).toBeLessThanOrEqual(5);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/unknown');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
    });
  });
});
