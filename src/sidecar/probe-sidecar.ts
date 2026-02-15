/**
 * Sidecar Probe Process
 *
 * A lightweight, independent process that monitors the main PerfSimNode app's
 * responsiveness. Because it runs on its own event loop, it can accurately
 * measure and report latency even when the main app's event loop is blocked.
 *
 * Communication:
 * - Probes the main app via HTTP GET /api/metrics/probe
 * - Sends results to the parent process via IPC (process.send)
 * - Parent relays results to the dashboard via the main Socket.IO server
 *
 * This design works on Azure App Service where only one port is exposed.
 *
 * @module sidecar/probe-sidecar
 */

import http from 'http';

// Configuration from environment (set by parent process)
const MAIN_APP_PORT = parseInt(process.env.MAIN_APP_PORT || '3000', 10);
const PROBE_INTERVAL_MS = parseInt(process.env.PROBE_INTERVAL_MS || '100', 10);
const PROBE_TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || '10000', 10);

// Track if a load test is active (detected from main app probe responses)
let loadTestActive = false;
let loadTestConcurrent = 0;

// Probe statistics
let probeCount = 0;
let probeErrors = 0;
let lastProbeLatency = 0;

/**
 * Send a message to the parent process via IPC.
 */
function sendToParent(type: string, data: Record<string, unknown>): void {
  if (process.send) {
    process.send({ type, ...data });
  }
}

/**
 * Starts the probe loop. Sends results to parent via IPC.
 * Uses a self-scheduling setTimeout pattern for consistent intervals.
 */
function startProbeLoop(): void {
  console.log(`[Sidecar] Monitoring main app on port ${MAIN_APP_PORT}`);
  console.log(`[Sidecar] Probe interval: ${PROBE_INTERVAL_MS}ms, timeout: ${PROBE_TIMEOUT_MS}ms`);

  const scheduleProbe = () => {
    setTimeout(() => {
      const startTime = Date.now();
      const timestamp = Date.now();

      const req = http.get({
        hostname: 'localhost',
        port: MAIN_APP_PORT,
        path: '/api/metrics/probe',
        headers: { 'X-Sidecar-Probe': 'true' },
        timeout: PROBE_TIMEOUT_MS,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          probeCount++;
          const latencyMs = Date.now() - startTime;
          lastProbeLatency = latencyMs;

          // Try to detect load test activity from probe response
          try {
            const data = JSON.parse(body);
            if (data.loadTest) {
              loadTestActive = data.loadTest.active;
              loadTestConcurrent = data.loadTest.concurrent || 0;
            }
          } catch {
            // Probe response may not be JSON, that's fine
          }

          // Send probe result to parent
          sendToParent('sidecarProbe', {
            latencyMs,
            timestamp,
            success: true,
            loadTestActive,
            loadTestConcurrent,
          });

          scheduleProbe();
        });
      });

      req.on('error', (err) => {
        probeErrors++;
        const latencyMs = Date.now() - startTime;
        lastProbeLatency = latencyMs;

        sendToParent('sidecarProbe', {
          latencyMs,
          timestamp,
          success: false,
          error: err.message,
          loadTestActive,
          loadTestConcurrent,
        });

        scheduleProbe();
      });

      req.on('timeout', () => {
        req.destroy();
        probeErrors++;
        const latencyMs = Date.now() - startTime;
        lastProbeLatency = latencyMs;

        sendToParent('sidecarProbe', {
          latencyMs,
          timestamp,
          success: false,
          error: 'timeout',
          loadTestActive,
          loadTestConcurrent,
        });

        scheduleProbe();
      });
    }, PROBE_INTERVAL_MS);
  };

  scheduleProbe();

  // Log probe stats every 60 seconds
  setInterval(() => {
    console.log(`[Sidecar] Probes: ${probeCount} ok, ${probeErrors} errors, last: ${lastProbeLatency}ms`);
  }, 60000);
}

// Start the probe loop
startProbeLoop();
