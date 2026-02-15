/**
 * =============================================================================
 * SIDECAR PROBE PROCESS — Independent Latency Monitor
 * =============================================================================
 *
 * PURPOSE:
 *   An independent child process that measures the main app's HTTP response
 *   latency. Because it has its OWN event loop (separate OS process), it can
 *   accurately detect and measure event loop blocking in the main app.
 *
 * WHY A SIDECAR:
 *   If latency measurement ran inside the main app, it would be affected by
 *   the same event loop blocking it's trying to detect. By running in a
 *   separate process, the sidecar can send probes even when the main app
 *   is completely frozen.
 *
 * ARCHITECTURE:
 *   ┌──────────────┐  HTTP GET /api/metrics/probe  ┌────────────────┐
 *   │   Sidecar    │ ─────────────────────────────> │   Main App     │
 *   │  (this file) │ <───────────────────────────── │  (port 3000)   │
 *   │              │       JSON response            │                │
 *   │              │                                │                │
 *   │              │  IPC process.send()            │                │
 *   │              │ ─────────────────────────────> │  Parent handler │
 *   │              │   { latencyMs, timestamp }     │  → Socket.IO   │
 *   └──────────────┘                                │  → Dashboard   │
 *                                                   └────────────────┘
 *
 * DATA FLOW:
 *   1. Sidecar probes main app via HTTP every PROBE_INTERVAL_MS (default 100ms)
 *   2. Measures round-trip time for each probe request
 *   3. Sends result to parent process via Node IPC (process.send)
 *   4. Parent process (index.ts) relays result to dashboard via Socket.IO
 *   5. Dashboard renders real-time latency chart (charts.js)
 *
 * PROBE BEHAVIOR DURING EVENT LOOP BLOCKING:
 *   When the main app's event loop is blocked, incoming HTTP requests queue up.
 *   The sidecar continues SENDING probes on schedule (its event loop is fine).
 *   The probes queue on the main app's side. When the block ends, all queued
 *   probes complete rapidly, each reporting their full wait time. This creates
 *   a characteristic "ramp-down" pattern in the latency chart.
 *
 * AZURE APP SERVICE CONSTRAINT:
 *   Azure App Service exposes only ONE port (80/443 → app port). The sidecar
 *   cannot listen on a separate port. Instead, it probes the main app over
 *   localhost and communicates results via IPC — both of which work fine
 *   within the same App Service container.
 *
 * PORTING NOTES:
 *   - Java: Use a ScheduledExecutorService with a Runnable that makes
 *     HttpClient.send() calls. Communication via shared ConcurrentLinkedQueue
 *     or a message broker.
 *   - Python: asyncio.create_task() or a separate threading.Thread with
 *     requests.get() calls. Use multiprocessing.Queue for IPC.
 *   - C#: BackgroundService (IHostedService) with HttpClient in a timer loop.
 *     Use Channel<T> or ConcurrentQueue<T> for communication.
 *   - PHP: A separate CLI script invoked by the main process, or use
 *     ReactPHP for an event-loop-based probe.
 *
 *   The key concept to preserve: the probe MUST run independently of the
 *   main app's request processing. In thread-based runtimes (Java, C#),
 *   a separate thread suffices. In single-threaded runtimes (Node, Python),
 *   a separate process is required.
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
 * Send a structured message to the parent process via Node.js IPC channel.
 *
 * The IPC channel is automatically established when the parent uses
 * child_process.fork(). Messages are serialized/deserialized automatically.
 *
 * PORTING: In Java/C#, use a shared queue or message broker instead of IPC.
 * In Python multiprocessing, use multiprocessing.Queue.
 */
function sendToParent(type: string, data: Record<string, unknown>): void {
  if (process.send) {
    process.send({ type, ...data });
  }
}

/**
 * Starts the probe loop — the core monitoring logic.
 *
 * TIMING MODEL:
 *   Uses setInterval to fire probes at a FIXED RATE (not fixed delay).
 *   This means probes are sent every PROBE_INTERVAL_MS regardless of
 *   whether previous probes have completed. This is important because:
 *
 *   - During normal operation: probes complete in ~1-5ms, well within interval
 *   - During event loop blocking: probes queue on main app's socket
 *   - When block ends: all queued probes complete rapidly, each reporting
 *     their actual wall-clock wait time
 *   - Result: the latency chart shows a "ramp-down" pattern that reveals
 *     the total duration of the block
 *
 * LOAD TEST DETECTION:
 *   The probe endpoint (/api/metrics/probe) also returns load test status.
 *   The sidecar parses this to track whether a load test is active and how
 *   many concurrent requests are in flight. This information is forwarded
 *   to the dashboard for display alongside latency data.
 *
 * PORTING: The fixed-rate timer concept is the same across all platforms:
 *   - Java: ScheduledExecutorService.scheduleAtFixedRate()
 *   - Python: asyncio loop or threading.Timer in a loop
 *   - C#: System.Threading.Timer or PeriodicTimer (.NET 6+)
 */
function startProbeLoop(): void {
  console.log(`[Sidecar] Monitoring main app on port ${MAIN_APP_PORT}`);
  console.log(`[Sidecar] Probe interval: ${PROBE_INTERVAL_MS}ms, timeout: ${PROBE_TIMEOUT_MS}ms`);

  setInterval(() => {
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
    });
  }, PROBE_INTERVAL_MS);

  // Log probe stats every 60 seconds
  setInterval(() => {
    console.log(`[Sidecar] Probes: ${probeCount} ok, ${probeErrors} errors, last: ${lastProbeLatency}ms`);
  }, 60000);
}

// Start the probe loop
startProbeLoop();
