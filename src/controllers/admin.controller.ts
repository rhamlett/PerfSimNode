/**
 * =============================================================================
 * ADMIN CONTROLLER — Administrative & Diagnostic REST API
 * =============================================================================
 *
 * PURPOSE:
 *   Provides administrative endpoints for system status, event logs, and
 *   diagnostic information. These are used by the dashboard and for
 *   troubleshooting deployment issues.
 *
 * ENDPOINTS:
 *   GET /api/simulations        → List all active simulations (any type)
 *   GET /api/admin/status       → Comprehensive status (config + simulations + metrics)
 *   GET /api/admin/events       → Recent event log entries (with limit parameter)
 *   GET /api/admin/memory-debug → Memory diagnostic info (cgroup, OS, process)
 *   GET /api/admin/system-info  → System info (CPU count, model, platform)
 *   GET /api/admin/network-debug → Network diagnostic info (DNS, HTTPS tests)
 *
 * DIAGNOSTIC ENDPOINTS:
 *   memory-debug and network-debug are Azure-specific debugging tools.
 *   memory-debug reads Linux cgroup files to understand container memory limits.
 *   network-debug performs DNS lookups and HTTPS requests to diagnose routing.
 *
 * PORTING NOTES:
 *   - Diagnostic endpoints reading /sys/fs/cgroup are Linux-specific.
 *     On Windows/macOS, use platform-native memory APIs.
 *   - Network debug with dns.resolve4/dns.lookup: use equivalent DNS APIs.
 *   - The /api/simulations listing endpoint aggregates across all simulation
 *     types — implement as a query across all service registries.
 *
 * @module controllers/admin
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as dns from 'dns';
import * as https from 'https';
import { SimulationTrackerService } from '../services/simulation-tracker.service';
import { EventLogService } from '../services/event-log.service';
import { MetricsService } from '../services/metrics.service';
import { config, APP_VERSION } from '../config';
import { validateOptionalInteger } from '../middleware/validation';

/**
 * Express router for admin endpoints.
 */
export const adminRouter = Router();

/**
 * GET /api/simulations
 *
 * Lists all active simulations of any type.
 *
 * @route GET /api/simulations
 * @returns {Object} List of active simulations
 */
adminRouter.get('/simulations', (_req: Request, res: Response) => {
  const simulations = SimulationTrackerService.getActiveSimulations();

  res.json({
    simulations: simulations.map((sim) => ({
      id: sim.id,
      type: sim.type,
      status: sim.status,
      parameters: sim.parameters,
      startedAt: sim.startedAt.toISOString(),
      scheduledEndAt: sim.scheduledEndAt.toISOString(),
    })),
    count: simulations.length,
  });
});

/**
 * GET /api/admin/status
 *
 * Returns detailed admin status including configuration and simulations.
 *
 * @route GET /api/admin/status
 * @returns {AdminStatusResponse} Detailed admin status
 */
adminRouter.get('/admin/status', (_req: Request, res: Response) => {
  const simulations = SimulationTrackerService.getActiveSimulations();
  const metrics = MetricsService.getMetrics();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime() * 100) / 100,
    version: APP_VERSION,
    config: {
      port: config.port,
      metricsIntervalMs: config.metricsIntervalMs,
      maxSimulationDurationSeconds: config.maxSimulationDurationSeconds,
      maxMemoryAllocationMb: config.maxMemoryAllocationMb,
      eventLogMaxEntries: config.eventLogMaxEntries,
    },
    activeSimulations: simulations.map((sim) => ({
      id: sim.id,
      type: sim.type,
      status: sim.status,
      parameters: sim.parameters,
      startedAt: sim.startedAt.toISOString(),
      scheduledEndAt: sim.scheduledEndAt.toISOString(),
    })),
    simulationCount: simulations.length,
    metrics: {
      ...metrics,
      timestamp: metrics.timestamp.toISOString(),
    },
  });
});

/**
 * GET /api/admin/events
 *
 * Returns recent event log entries.
 *
 * @route GET /api/admin/events
 * @query {number} limit - Maximum number of events to return (default: 50, max: 100)
 * @returns {Object} Recent event log entries
 */
adminRouter.get('/admin/events', (req: Request, res: Response) => {
  const limit = validateOptionalInteger(req.query.limit, 'limit', 1, 100, 50);
  const events = EventLogService.getRecentEntries(limit);

  res.json({
    events: events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      level: event.level,
      event: event.event,
      message: event.message,
      simulationId: event.simulationId,
      simulationType: event.simulationType,
      details: event.details,
    })),
    count: events.length,
    total: EventLogService.getCount(),
  });
});

/**
 * GET /api/admin/memory-debug
 *
 * Returns diagnostic info about memory detection for troubleshooting.
 *
 * @route GET /api/admin/memory-debug
 * @returns {Object} Memory detection diagnostic info
 */
adminRouter.get('/admin/memory-debug', (_req: Request, res: Response) => {
  const cgroupPaths = [
    // cgroup v2 paths
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory.high',
    '/sys/fs/cgroup/memory.current',
    // cgroup v1 paths
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    '/sys/fs/cgroup/memory/memory.soft_limit_in_bytes',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes',
    // Alternative cgroup v1 paths (some containers)
    '/sys/fs/cgroup/memory.limit_in_bytes',
  ];

  const results: Record<string, string | null> = {};
  
  for (const path of cgroupPaths) {
    try {
      if (fs.existsSync(path)) {
        results[path] = fs.readFileSync(path, 'utf8').trim();
      } else {
        results[path] = null;
      }
    } catch (err) {
      results[path] = `error: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }

  // Check what directories exist
  const cgroupDirs = [
    '/sys/fs/cgroup',
    '/sys/fs/cgroup/memory',
  ];
  
  const dirContents: Record<string, string[] | string> = {};
  for (const dir of cgroupDirs) {
    try {
      if (fs.existsSync(dir)) {
        dirContents[dir] = fs.readdirSync(dir).slice(0, 50); // Limit to 50 entries
      } else {
        dirContents[dir] = 'does not exist';
      }
    } catch (err) {
      dirContents[dir] = `error: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }

  const metrics = MetricsService.getMetrics();

  res.json({
    osTotalmem: os.totalmem(),
    osTotalmemMb: Math.round(os.totalmem() / 1024 / 1024),
    osFreemem: os.freemem(),
    osFreememMb: Math.round(os.freemem() / 1024 / 1024),
    reportedTotalMb: metrics.memory.totalSystemMb,
    cgroupFiles: results,
    cgroupDirectories: dirContents,
    processMemory: process.memoryUsage(),
    platform: os.platform(),
    release: os.release(),
  });
});

/**
 * GET /api/admin/system-info
 *
 * Returns system information including CPU count and model.
 * Useful for diagnosing CPU stress simulation behavior.
 *
 * @route GET /api/admin/system-info
 * @returns {Object} System information
 */
adminRouter.get('/admin/system-info', (_req: Request, res: Response) => {
  const cpuInfo = os.cpus();
  res.json({
    cpuCount: cpuInfo.length,
    cpuModel: cpuInfo[0]?.model || 'unknown',
    cpuSpeed: cpuInfo[0]?.speed || 0,
    platform: os.platform(),
    arch: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    nodeVersion: process.version,
    websiteHostname: process.env.WEBSITE_HOSTNAME || null,
    websiteSku: process.env.WEBSITE_SKU || null,
  });
});

/**
 * GET /api/admin/network-debug
 *
 * Diagnostic endpoint to understand network environment and HTTP routing on Azure.
 * Helps debug why self-requests may not appear in AppLens.
 *
 * @route GET /api/admin/network-debug
 * @returns {Object} Network diagnostic information
 */
adminRouter.get('/admin/network-debug', async (_req: Request, res: Response) => {
  const websiteHostname = process.env.WEBSITE_HOSTNAME;
  const results: Record<string, unknown> = {};

  // Collect Azure environment variables
  results.azureEnvVars = {
    WEBSITE_HOSTNAME: process.env.WEBSITE_HOSTNAME,
    WEBSITE_SITE_NAME: process.env.WEBSITE_SITE_NAME,
    WEBSITE_INSTANCE_ID: process.env.WEBSITE_INSTANCE_ID,
    WEBSITE_SKU: process.env.WEBSITE_SKU,
    REGION_NAME: process.env.REGION_NAME,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    WEBSITE_PRIVATE_IP: process.env.WEBSITE_PRIVATE_IP,
    WEBSITE_PRIVATE_PORTS: process.env.WEBSITE_PRIVATE_PORTS,
    REMOTEDEBUGGINGPORT: process.env.REMOTEDEBUGGINGPORT,
    APPSVC_TUNNEL_PORT: process.env.APPSVC_TUNNEL_PORT,
  };

  // DNS lookup for the hostname
  if (websiteHostname) {
    try {
      const addresses = await new Promise<string[]>((resolve, reject) => {
        dns.resolve4(websiteHostname, (err, addrs) => {
          if (err) reject(err);
          else resolve(addrs);
        });
      });
      results.dnsLookup = { hostname: websiteHostname, addresses };
    } catch (err) {
      results.dnsLookup = { hostname: websiteHostname, error: err instanceof Error ? err.message : 'unknown' };
    }

    // Also try dns.lookup (uses OS resolver)
    try {
      const lookupResult = await new Promise<{ address: string; family: number }>((resolve, reject) => {
        dns.lookup(websiteHostname, (err, address, family) => {
          if (err) reject(err);
          else resolve({ address, family });
        });
      });
      results.osLookup = { hostname: websiteHostname, ...lookupResult };
    } catch (err) {
      results.osLookup = { hostname: websiteHostname, error: err instanceof Error ? err.message : 'unknown' };
    }
  }

  // Network interfaces
  results.networkInterfaces = os.networkInterfaces();

  // Test an HTTPS request with various options
  if (websiteHostname) {
    const testUrl = `https://${websiteHostname}/api/metrics/probe`;
    
    // Test 1: Default HTTPS request
    try {
      const startTime = Date.now();
      const testResult = await new Promise<{ statusCode: number; headers: Record<string, unknown>; latencyMs: number; localAddress?: string; remoteAddress?: string }>((resolve, reject) => {
        const req = https.get(testUrl, { 
          headers: { 'User-Agent': 'PerfSimNode-NetworkDebug/1.0' }
        }, (response) => {
          response.on('data', () => {});
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode || 0,
              headers: response.headers as Record<string, unknown>,
              latencyMs: Date.now() - startTime,
              localAddress: req.socket?.localAddress,
              remoteAddress: req.socket?.remoteAddress,
            });
          });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      results.httpsTest = { url: testUrl, ...testResult };
    } catch (err) {
      results.httpsTest = { url: testUrl, error: err instanceof Error ? err.message : 'unknown' };
    }

    // Test 2: HTTPS with agent: false (no connection pooling)
    try {
      const startTime = Date.now();
      const testResult = await new Promise<{ statusCode: number; latencyMs: number; localAddress?: string; remoteAddress?: string }>((resolve, reject) => {
        const req = https.get(testUrl, { 
          agent: false,
          headers: { 'User-Agent': 'PerfSimNode-NetworkDebug-NoPool/1.0' }
        }, (response) => {
          response.on('data', () => {});
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode || 0,
              latencyMs: Date.now() - startTime,
              localAddress: req.socket?.localAddress,
              remoteAddress: req.socket?.remoteAddress,
            });
          });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      results.httpsTestNoPool = { url: testUrl, ...testResult };
    } catch (err) {
      results.httpsTestNoPool = { url: testUrl, error: err instanceof Error ? err.message : 'unknown' };
    }
  }

  res.json(results);
});
