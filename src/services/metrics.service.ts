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

// Marker value used by cgroups when memory is unlimited
const CGROUP_UNLIMITED = 9223372036854771712;

/**
 * Reads a cgroup file and returns its numeric value, or null if unavailable.
 */
function readCgroupValue(path: string): number | null {
  try {
    if (fs.existsSync(path)) {
      const content = fs.readFileSync(path, 'utf8').trim();
      if (content === 'max') return null; // cgroup v2 unlimited marker
      const value = parseInt(content, 10);
      if (!isNaN(value) && value > 0 && value < CGROUP_UNLIMITED) {
        return value;
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Detects the container memory limit by checking multiple sources.
 * Automatically works in Docker, Kubernetes, Azure App Service, etc.
 * 
 * @returns Object with limit in bytes and detection source
 */
function detectContainerMemoryLimit(): { limit: number; source: string } {
  const osTotalMem = os.totalmem();
  
  // Cgroup v2 paths (modern systems)
  const cgroupV2Paths = [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory.high',
  ];
  
  // Cgroup v1 paths (older systems, including many Azure containers)
  const cgroupV1Paths = [
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    '/sys/fs/cgroup/memory/memory.soft_limit_in_bytes',
  ];
  
  // Try cgroup v2 first
  for (const path of cgroupV2Paths) {
    const value = readCgroupValue(path);
    if (value !== null) {
      return { limit: value, source: `cgroup v2: ${path}` };
    }
  }
  
  // Try cgroup v1
  for (const path of cgroupV1Paths) {
    const value = readCgroupValue(path);
    if (value !== null) {
      return { limit: value, source: `cgroup v1: ${path}` };
    }
  }
  
  // Fall back to OS total memory
  return { limit: osTotalMem, source: 'os.totalmem()' };
}

// Detect and cache the container memory limit at startup
const memoryDetection = detectContainerMemoryLimit();
const containerMemoryLimit = memoryDetection.limit;

// Log detection result on startup
console.log(`[Metrics] Memory limit detected: ${bytesToMb(containerMemoryLimit).toFixed(0)} MB (source: ${memoryDetection.source})`);
console.log(`[Metrics] OS reports total: ${bytesToMb(os.totalmem()).toFixed(0)} MB`);

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
