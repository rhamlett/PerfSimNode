/**
 * Metrics Service
 *
 * Collects system metrics including CPU, memory, and event loop statistics.
 *
 * @module services/metrics
 */

import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import * as os from 'os';
import {
  SystemMetrics,
  CpuMetrics,
  MemoryMetrics,
  EventLoopMetrics,
  ProcessMetrics,
} from '../types';
import { bytesToMb, nsToMs } from '../utils';

// Log memory info on startup
console.log(`[Metrics] Host memory available: ${bytesToMb(os.totalmem()).toFixed(0)} MB`);

/**
 * Snapshot of CPU times for calculating usage between intervals.
 */
interface CpuSnapshot {
  idle: number;
  total: number;
}

/**
 * Service for collecting system metrics.
 *
 * Tracks CPU usage, memory consumption, event loop lag, and process stats.
 */
class MetricsServiceClass {
  private histogram: IntervalHistogram;
  private lastCpuSnapshot: CpuSnapshot | null = null;
  
  // Real-time heartbeat lag measurement
  // This measures actual time for setImmediate to fire, showing real blocking
  private heartbeatLagMs: number = 0;

  constructor() {
    // Initialize event loop delay histogram with 10ms resolution
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();

    // Initialize system-wide CPU tracking
    this.lastCpuSnapshot = this.getCpuSnapshot();
    
    // Start heartbeat measurement
    this.startHeartbeat();
  }
  
  /**
   * Gets a snapshot of system-wide CPU times.
   * Uses os.cpus() to capture all CPU activity including child processes.
   */
  private getCpuSnapshot(): CpuSnapshot {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    
    return { idle, total };
  }
  
  /**
   * Starts the heartbeat measurement loop.
   * Schedules setImmediate callbacks and measures how long they take to fire.
   * This provides real-time visibility into event loop blocking.
   */
  private startHeartbeat(): void {
    const measureHeartbeat = () => {
      const start = Date.now();
      setImmediate(() => {
        this.heartbeatLagMs = Date.now() - start;
      });
    };
    
    // Measure heartbeat every 100ms (runs forever for this singleton service)
    setInterval(measureHeartbeat, 100);
    // Initial measurement
    measureHeartbeat();
  }

  /**
   * Collects current CPU metrics using system-wide measurement.
   * This captures CPU usage from all processes including forked workers.
   *
   * @returns CPU usage metrics
   */
  getCpuMetrics(): CpuMetrics {
    const currentSnapshot = this.getCpuSnapshot();
    
    let usagePercent = 0;
    
    if (this.lastCpuSnapshot) {
      const idleDiff = currentSnapshot.idle - this.lastCpuSnapshot.idle;
      const totalDiff = currentSnapshot.total - this.lastCpuSnapshot.total;
      
      if (totalDiff > 0) {
        // CPU usage = (1 - idle/total) * 100
        usagePercent = ((totalDiff - idleDiff) / totalDiff) * 100;
      }
    }
    
    // Update snapshot for next call
    this.lastCpuSnapshot = currentSnapshot;

    // Also get process-level stats for the user/system breakdown
    const processUsage = process.cpuUsage();

    return {
      usagePercent: Math.min(100, Math.round(usagePercent * 100) / 100),
      user: processUsage.user,
      system: processUsage.system,
    };
  }

  /**
   * Collects current memory metrics.
   *
   * @returns Memory usage metrics
   */
  getMemoryMetrics(): MemoryMetrics {
    const memUsage = process.memoryUsage();

    return {
      heapUsedMb: bytesToMb(memUsage.heapUsed),
      heapTotalMb: bytesToMb(memUsage.heapTotal),
      rssMb: bytesToMb(memUsage.rss),
      externalMb: bytesToMb(memUsage.external),
      totalSystemMb: bytesToMb(os.totalmem()),
    };
  }

  /**
   * Collects event loop lag metrics.
   *
   * @returns Event loop metrics
   */
  getEventLoopMetrics(): EventLoopMetrics {
    return {
      lagMs: nsToMs(this.histogram.mean),
      heartbeatLagMs: this.heartbeatLagMs,
      lagP99Ms: nsToMs(this.histogram.percentile(99)),
      minMs: nsToMs(this.histogram.min),
      maxMs: nsToMs(this.histogram.max),
    };
  }

  /**
   * Collects process-level metrics.
   *
   * @returns Process metrics
   */
  getProcessMetrics(): ProcessMetrics {
    return {
      pid: process.pid,
      // @ts-expect-error - _getActiveHandles and _getActiveRequests are internal Node.js APIs
      activeHandles: (process._getActiveHandles?.()?.length as number) ?? 0,
      // @ts-expect-error - _getActiveRequests is an internal Node.js API
      activeRequests: (process._getActiveRequests?.()?.length as number) ?? 0,
      uptime: Math.round(process.uptime() * 100) / 100,
    };
  }

  /**
   * Collects all system metrics.
   *
   * @returns Complete system metrics snapshot
   */
  getMetrics(): SystemMetrics {
    return {
      timestamp: new Date(),
      cpu: this.getCpuMetrics(),
      memory: this.getMemoryMetrics(),
      eventLoop: this.getEventLoopMetrics(),
      process: this.getProcessMetrics(),
    };
  }

  /**
   * Resets the event loop histogram.
   *
   * Useful for getting fresh min/max values after a simulation.
   */
  resetHistogram(): void {
    this.histogram.reset();
  }
}

/**
 * Singleton instance of the MetricsService.
 */
export const MetricsService = new MetricsServiceClass();
