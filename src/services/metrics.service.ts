/**
 * =============================================================================
 * METRICS SERVICE — Real-Time System Metrics Collection
 * =============================================================================
 *
 * PURPOSE:
 *   Collects system metrics (CPU, memory, event loop, process stats) and provides
 *   them as a unified snapshot. Called periodically by the main server loop
 *   (index.ts) and broadcast to all WebSocket clients for the dashboard.
 *
 * METRICS COLLECTED:
 *   1. CPU Usage — System-wide percentage using os.cpus() idle/total comparison
 *      between snapshots. Captures ALL processes (main + forked workers).
 *   2. Memory — V8 heap (managed GC objects), RSS (total physical memory),
 *      external (native C++ allocations), system total RAM.
 *   3. Event Loop Lag — Two measurements:
 *      a) Histogram mean from perf_hooks.monitorEventLoopDelay (precise but averaged)
 *      b) Heartbeat lag: wall-clock time for setImmediate callback (intuitive, real-time)
 *   4. Process — PID (for restart detection), handles, requests, uptime.
 *
 * SINGLETON PATTERN:
 *   Instantiated once at module load time. The constructor starts the event loop
 *   histogram and heartbeat monitor which run for the lifetime of the process.
 *
 * PORTING NOTES:
 *   - Java: Create a MetricsService bean with @Scheduled collection.
 *     CPU: OperatingSystemMXBean; Memory: MemoryMXBean; Threads: ThreadMXBean.
 *   - Python: Use psutil for CPU/memory, asyncio loop time for event loop lag.
 *   - C#: Use System.Diagnostics.Process and PerformanceCounter.
 *   - PHP: Use sys_getloadavg(), memory_get_usage(), getmypid().
 *   Key: System-wide CPU measurement (not just current process) because
 *   CPU stress spawns child processes.
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
 * DESIGN: Maintains state between calls for delta-based calculations:
 *   - lastCpuSnapshot: Previous CPU times for percentage calculation
 *   - histogram: Running event loop delay histogram (reset-able)
 *   - heartbeatLagMs: Latest setImmediate timing measurement
 *
 * All methods are synchronous (no async I/O) so they can be called
 * from a setInterval without introducing concurrency issues.
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
   * Uses os.cpus() to capture ALL CPU activity across all cores and processes.
   * Returns aggregate idle and total time — the delta between two snapshots
   * gives us CPU usage percentage.
   *
   * PORTING NOTES:
   *   This is the key to measuring CPU from child worker processes.
   *   In Java: ManagementFactory.getOperatingSystemMXBean().getSystemCpuLoad()
   *   In Python: psutil.cpu_times() for per-CPU breakdowns
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
   *
   * ALGORITHM:
   * 1. Record current time (Date.now())
   * 2. Schedule a setImmediate callback
   * 3. When callback fires, measure elapsed time
   * 4. If event loop is idle: ~0-1ms. If blocked: equals the block duration.
   *
   * This provides an intuitive, real-time indicator of event loop health.
   * The dashboard displays this value prominently for instant visual feedback.
   *
   * PORTING NOTES:
   *   Concept: schedule a minimal callback and measure how long the runtime
   *   takes to actually execute it. Long delay = main thread is blocked.
   *   - Java: ScheduledExecutorService.schedule() with timing
   *   - Python asyncio: loop.call_soon() with time measurement
   *   - C#: ThreadPool.QueueUserWorkItem() with Stopwatch
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
