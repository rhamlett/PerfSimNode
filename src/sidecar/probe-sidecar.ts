/**
 * Sidecar Probe Server
 *
 * A lightweight, independent process that monitors the main PerfSimNode app's
 * responsiveness. Because it runs on its own event loop, it can accurately
 * measure and report latency even when the main app's event loop is blocked.
 *
 * Communication:
 * - Probes the main app via HTTP GET /api/metrics/probe
 * - Serves its own Socket.IO endpoint for the dashboard to connect to
 * - Broadcasts probe results in real-time to connected clients
 *
 * @module sidecar/probe-sidecar
 */

import http from 'http';
import { Server as SocketServer } from 'socket.io';

// Configuration from environment (set by parent process)
const MAIN_APP_PORT = parseInt(process.env.MAIN_APP_PORT || '3000', 10);
const SIDECAR_PORT = parseInt(process.env.SIDECAR_PORT || '3001', 10);
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
 * Creates and starts the sidecar HTTP server with Socket.IO.
 */
function startSidecar(): void {
  const server = http.createServer((_req, res) => {
    // Simple health endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      role: 'sidecar-probe',
      mainAppPort: MAIN_APP_PORT,
      probeCount,
      probeErrors,
      lastProbeLatency,
      loadTestActive,
    }));
  });

  const io = new SocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log(`[Sidecar] Dashboard connected: ${socket.id}`);

    // Send current state immediately on connect
    socket.emit('sidecarStatus', {
      connected: true,
      mainAppPort: MAIN_APP_PORT,
      probeIntervalMs: PROBE_INTERVAL_MS,
      loadTestActive,
      loadTestConcurrent,
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Sidecar] Dashboard disconnected: ${socket.id} (${reason})`);
    });
  });

  // Start the probe loop
  startProbeLoop(io);

  server.listen(SIDECAR_PORT, () => {
    console.log(`[Sidecar] Probe server running on http://localhost:${SIDECAR_PORT}`);
    console.log(`[Sidecar] Monitoring main app on port ${MAIN_APP_PORT}`);
    console.log(`[Sidecar] Probe interval: ${PROBE_INTERVAL_MS}ms, timeout: ${PROBE_TIMEOUT_MS}ms`);
  });
}

/**
 * Probes the main app and broadcasts the result via Socket.IO.
 * Uses a self-scheduling setTimeout pattern for consistent intervals.
 */
function startProbeLoop(io: SocketServer): void {
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

          // Try to detect load test activity from probe response headers or body
          try {
            const data = JSON.parse(body);
            if (data.loadTest) {
              const wasActive = loadTestActive;
              loadTestActive = data.loadTest.active;
              loadTestConcurrent = data.loadTest.concurrent || 0;

              // Notify on state change
              if (!wasActive && loadTestActive) {
                io.emit('loadTestStateChange', { active: true, concurrent: loadTestConcurrent });
              } else if (wasActive && !loadTestActive) {
                io.emit('loadTestStateChange', { active: false, concurrent: 0 });
              }
            }
          } catch {
            // Probe response may not be JSON, that's fine
          }

          // Broadcast probe result
          io.emit('sidecarProbe', {
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

        // Emit failure probe - this is valuable data (shows the app is unresponsive)
        io.emit('sidecarProbe', {
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

        io.emit('sidecarProbe', {
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
}

// Start the sidecar
startSidecar();
