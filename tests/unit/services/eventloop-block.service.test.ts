/**
 * Event Loop Block Service Unit Tests
 */

import { EventLoopBlockService } from '../../../src/services/eventloop-block.service';

describe('EventLoopBlockService', () => {
  describe('block', () => {
    it('should block event loop for specified duration', () => {
      const startTime = Date.now();
      const durationSeconds = 1;

      const simulation = EventLoopBlockService.block({ durationSeconds });

      const elapsedMs = Date.now() - startTime;

      expect(simulation).toBeDefined();
      expect(simulation.type).toBe('EVENT_LOOP_BLOCKING');
      expect(simulation.status).toBe('COMPLETED');
      expect(elapsedMs).toBeGreaterThanOrEqual(durationSeconds * 1000 - 100); // Allow 100ms tolerance
    });

    it('should return completed simulation with timing info', () => {
      const simulation = EventLoopBlockService.block({ durationSeconds: 1 });

      expect(simulation.startedAt).toBeInstanceOf(Date);
      expect(simulation.stoppedAt).toBeInstanceOf(Date);
      expect(simulation.stoppedAt!.getTime()).toBeGreaterThan(simulation.startedAt.getTime());
    });
  });

  // Note: Longer blocking tests are skipped to keep test suite fast
  describe.skip('long duration blocking', () => {
    it('should handle longer blocking durations', () => {
      const simulation = EventLoopBlockService.block({ durationSeconds: 5 });
      expect(simulation.status).toBe('COMPLETED');
    });
  });
});
