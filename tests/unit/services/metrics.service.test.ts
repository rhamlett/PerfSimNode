/**
 * Metrics Service Unit Tests
 */

import { MetricsService } from '../../../src/services/metrics.service';

describe('MetricsService', () => {
  describe('getMetrics', () => {
    it('should return complete system metrics', () => {
      const metrics = MetricsService.getMetrics();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('eventLoop');
      expect(metrics).toHaveProperty('process');
    });

    it('should return valid CPU metrics', () => {
      const metrics = MetricsService.getMetrics();

      expect(metrics.cpu).toHaveProperty('usagePercent');
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');
      expect(typeof metrics.cpu.usagePercent).toBe('number');
      expect(metrics.cpu.usagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.cpu.usagePercent).toBeLessThanOrEqual(100);
    });

    it('should return valid memory metrics', () => {
      const metrics = MetricsService.getMetrics();

      expect(metrics.memory).toHaveProperty('heapUsedMb');
      expect(metrics.memory).toHaveProperty('heapTotalMb');
      expect(metrics.memory).toHaveProperty('rssMb');
      expect(metrics.memory).toHaveProperty('externalMb');
      expect(typeof metrics.memory.heapUsedMb).toBe('number');
      expect(metrics.memory.heapUsedMb).toBeGreaterThan(0);
    });

    it('should return valid event loop metrics', () => {
      const metrics = MetricsService.getMetrics();

      expect(metrics.eventLoop).toHaveProperty('lagMs');
      expect(metrics.eventLoop).toHaveProperty('heartbeatLagMs');
      expect(metrics.eventLoop).toHaveProperty('lagP99Ms');
      expect(metrics.eventLoop).toHaveProperty('minMs');
      expect(metrics.eventLoop).toHaveProperty('maxMs');
      expect(typeof metrics.eventLoop.lagMs).toBe('number');
      expect(typeof metrics.eventLoop.heartbeatLagMs).toBe('number');
    });

    it('should return valid process metrics', () => {
      const metrics = MetricsService.getMetrics();

      expect(metrics.process).toHaveProperty('activeHandles');
      expect(metrics.process).toHaveProperty('activeRequests');
      expect(metrics.process).toHaveProperty('uptime');
      expect(typeof metrics.process.uptime).toBe('number');
      expect(metrics.process.uptime).toBeGreaterThan(0);
    });
  });

  describe('getCpuMetrics', () => {
    it('should track CPU usage over time', async () => {
      // First call establishes baseline
      MetricsService.getCpuMetrics();

      // Wait a bit for CPU activity
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second call should show difference
      const metrics = MetricsService.getCpuMetrics();

      expect(metrics.usagePercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getMemoryMetrics', () => {
    it('should return current memory usage', () => {
      const metrics = MetricsService.getMemoryMetrics();

      expect(metrics.heapUsedMb).toBeLessThanOrEqual(metrics.heapTotalMb);
      expect(metrics.rssMb).toBeGreaterThan(0);
    });
  });

  describe('resetHistogram', () => {
    it('should reset event loop histogram without error', () => {
      expect(() => MetricsService.resetHistogram()).not.toThrow();
    });
  });
});
