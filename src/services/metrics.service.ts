/**
 * Metrics Service
 *
 * Collects system metrics including CPU, memory, and event loop statistics.
 *
 * @module services/metrics
 */

import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';
import * as os from 'os';
import * as fs from 'fs';
import {
  SystemMetrics,
  CpuMetrics,
  MemoryMetrics,
  EventLoopMetrics,
  ProcessMetrics,
} from '../types';
import { bytesToMb, nsToMs } from '../utils';

/**
 * Detects the container memory limit.
 * Checks environment variables first, then cgroup files.
 * Falls back to os.totalmem() if not in a container.
 * 
 * @returns Memory limit in bytes
 */
function getContainerMemoryLimit(): number {
  // Check explicit override first (can be set in Azure App Service configuration)
  const containerMemLimitMb = process.env.CONTAINER_MEMORY_LIMIT_MB;
  if (containerMemLimitMb) {
    const limitMb = parseInt(containerMemLimitMb, 10);
    if (!isNaN(limitMb) && limitMb > 0) {
      return limitMb * 1024 * 1024;
    }
  }

  // Check Azure App Service environment variable
  const websiteMemoryLimitMb = process.env.WEBSITE_MEMORY_LIMIT_MB;
  if (websiteMemoryLimitMb) {
    const limitMb = parseInt(websiteMemoryLimitMb, 10);
    if (!isNaN(limitMb) && limitMb > 0) {
      return limitMb * 1024 * 1024;
    }
  }

  // Try cgroup v2 (newer systems)
  try {
    const cgroupV2Path = '/sys/fs/cgroup/memory.max';
    if (fs.existsSync(cgroupV2Path)) {
      const content = fs.readFileSync(cgroupV2Path, 'utf8').trim();
      if (content !== 'max') {
        const limit = parseInt(content, 10);
        // Accept any reasonable limit (not the "unlimited" marker)
        if (!isNaN(limit) && limit > 0 && limit < 9223372036854771712) {
          return limit;
        }
      }
    }
  } catch {
    // Ignore errors, fall through to next method
  }

  // Try cgroup v1 (older systems, common on Azure)
  try {
    const cgroupV1Path = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
    if (fs.existsSync(cgroupV1Path)) {
      const content = fs.readFileSync(cgroupV1Path, 'utf8').trim();
      const limit = parseInt(content, 10);
      // Cgroup v1 returns a very large number (9223372036854771712) when unlimited
      if (!isNaN(limit) && limit > 0 && limit < 9223372036854771712) {
        return limit;
      }
    }
  } catch {
    // Ignore errors, fall through to default
  }

  // Fall back to system total memory
  return os.totalmem();
}

// Cache the container memory limit (doesn't change during runtime)
const containerMemoryLimit = getContainerMemoryLimit();

/**
 * Service for collecting system metrics.
 *
 * Tracks CPU usage, memory consumption, event loop lag, and process stats.
 */
class MetricsServiceClass {
  private histogram: IntervalHistogram;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTime: number = Date.now();
  
  // Real-time heartbeat lag measurement
  // This measures actual time for setImmediate to fire, showing real blocking
  private heartbeatLagMs: number = 0;

  constructor() {
    // Initialize event loop delay histogram with 10ms resolution
    this.histogram = monitorEventLoopDelay({ resolution: 10 });
    this.histogram.enable();

    // Initialize CPU tracking
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
    
    // Start heartbeat measurement
    this.startHeartbeat();
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
   * Collects current CPU metrics.
   *
   * @returns CPU usage metrics
   */
  getCpuMetrics(): CpuMetrics {
    const currentUsage = process.cpuUsage(this.lastCpuUsage ?? undefined);
    const currentTime = Date.now();
    const elapsedMs = currentTime - this.lastCpuTime;

    // Calculate CPU percentage (user + system time vs elapsed time)
    // cpuUsage values are in microseconds
    const totalCpuMicros = currentUsage.user + currentUsage.system;
    const elapsedMicros = elapsedMs * 1000;
    const usagePercent = elapsedMicros > 0 ? (totalCpuMicros / elapsedMicros) * 100 : 0;

    // Update tracking for next call
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = currentTime;

    return {
      usagePercent: Math.min(100, Math.round(usagePercent * 100) / 100),
      user: currentUsage.user,
      system: currentUsage.system,
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
      totalSystemMb: bytesToMb(containerMemoryLimit),
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
