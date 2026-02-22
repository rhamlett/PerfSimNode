/**
 * =============================================================================
 * APPLICATION ENTRY POINT — Server Bootstrap & Process Management
 * =============================================================================
 *
 * PURPOSE:
 *   This is the main entry point that wires everything together:
 *   1. Initializes OpenTelemetry instrumentation (MUST be first import)
 *   2. Creates the Express app and wraps it in an HTTP server
 *   3. Initializes Socket.IO for real-time WebSocket communication
 *   4. Wires up event broadcasting (events → Socket.IO → dashboard)
 *   5. Starts periodic metrics broadcasting (every metricsIntervalMs)
 *   6. Spawns the sidecar probe process for independent latency monitoring
 *   7. Optionally starts curl-based probes for Azure AppLens visibility
 *
 * ARCHITECTURE:
 *   ┌─────────────────────────────────────────────────┐
 *   │  Main Process (this file)                       │
 *   │  ├─ Express HTTP Server (REST API)              │
 *   │  ├─ Socket.IO (WebSocket for real-time data)    │
 *   │  ├─ MetricsService (periodic metrics broadcast) │
 *   │  ├─ EventLogService (event broadcasting)        │
 *   │  └─ LoadTestService (stats broadcasting)        │
 *   └──────────────┬──────────────────────────────────┘
 *                  │ IPC (fork)
 *   ┌──────────────┴──────────────────────────────────┐
 *   │  Sidecar Process (probe-sidecar.ts)             │
 *   │  └─ HTTP probes → main app /api/metrics/probe   │
 *   │    Results sent back via IPC → Socket.IO emit    │
 *   └─────────────────────────────────────────────────┘
 *
 * REAL-TIME DATA FLOW:
 *   1. Metrics: MetricsService.getMetrics() → io.emit('metrics') every 250ms
 *   2. Events:  EventLogService.log() → broadcaster → io.emit('event')
 *   3. Latency: Sidecar HTTP probe → IPC message → io.emit('sidecarProbe')
 *   4. Load Test: LoadTestService stats → io.emit('loadTestStats') every 60s
 *
 * SIDECAR PATTERN:
 *   The sidecar probe process runs on its OWN event loop (separate Node.js
 *   process via child_process.fork()). This is critical because when the main
 *   app's event loop is blocked, it can't measure its own latency. The sidecar
 *   makes HTTP requests to the main app and measures response time externally.
 *
 * PORTING NOTES:
 *   - The "sidecar" concept maps to any background process/thread:
 *     Java: Separate thread with HttpClient; Python: subprocess or separate process.
 *   - Socket.IO → any WebSocket library (Java: Spring WebSocket, Python: websockets)
 *   - child_process.fork() → any process spawning API (Runtime.exec, subprocess)
 *   - The key architectural decisions to preserve:
 *     a) Real-time metrics via WebSocket (not polling)
 *     b) Independent latency monitoring from a separate process/thread
 *     c) Graceful shutdown with child process cleanup
 *
 * @module index
 */

// Initialize Azure Monitor OpenTelemetry FIRST - before any other imports
import './instrumentation';

import http from 'http';
import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { cpus } from 'os';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { config } from './config';
import { MetricsService } from './services/metrics.service';
import { EventLogService } from './services/event-log.service';
import { LoadTestService } from './services/load-test.service';

/**
 * Bootstrap and start the application server.
 *
 * This function:
 * 1. Creates the Express app (HTTP routing)
 * 2. Wraps it in an HTTP server (needed for Socket.IO to share the port)
 * 3. Initializes Socket.IO on the same HTTP server
 * 4. Wires up all real-time broadcasting (metrics, events, load test stats)
 * 5. Starts the sidecar probe process
 * 6. Begins listening on the configured port
 */
async function main(): Promise<void> {
  const app = createApp();
  const port = config.port;

  // Create HTTP server
  const server = http.createServer(app);

  // --------------------------------------------------------------------------
  // SOCKET.IO INITIALIZATION
  // Socket.IO provides WebSocket-based real-time communication between the
  // server and the browser dashboard. It shares the same HTTP server/port.
  //
  // PORTING NOTES:
  //   - Java: Use Spring WebSocket or javax.websocket
  //   - Python: Use python-socketio or websockets library
  //   - PHP: Use Ratchet or Laravel WebSockets (or server-sent events as alternative)
  //   - C#: Use SignalR (similar push-based real-time framework)
  // --------------------------------------------------------------------------
  const io = new SocketServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    // Use WebSocket directly, skip long-polling upgrade dance
    transports: ['websocket'],
    // Increase timeouts for stability during simulations
    pingTimeout: 60000,    // 60s before considering connection dead
    pingInterval: 25000,   // 25s between keep-alive pings
  });

  // --------------------------------------------------------------------------
  // EVENT BROADCASTING SETUP
  // Wire EventLogService to broadcast new events to all connected clients.
  // This is the "pub" side of pub/sub — any code that logs an event
  // automatically pushes it to all dashboard clients in real-time.
  // --------------------------------------------------------------------------
  EventLogService.setBroadcaster((event) => {
    io.emit('event', {
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      level: event.level,
      event: event.event,
      message: event.message,
      simulationId: event.simulationId,
      simulationType: event.simulationType,
    });
  });

  // Handle WebSocket connections
  io.on('connection', (socket) => {
    // Log to console only (not to event log - reduces noise for users)
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  // --------------------------------------------------------------------------
  // PERIODIC METRICS BROADCAST
  // Collects system metrics (CPU, memory, event loop, process info) at the
  // configured interval (default 250ms) and pushes to all WebSocket clients.
  // The dashboard uses this stream to update real-time charts.
  //
  // PORTING NOTES:
  //   Use a scheduled timer/executor to periodically collect and push metrics.
  //   Java: ScheduledExecutorService.scheduleAtFixedRate()
  //   Python: asyncio.create_task() with while-loop and await asyncio.sleep()
  //   C#: System.Threading.Timer or PeriodicTimer
  // --------------------------------------------------------------------------
  setInterval(() => {
    const metrics = MetricsService.getMetrics();
    io.emit('metrics', {
      timestamp: metrics.timestamp.toISOString(),
      cpu: metrics.cpu,
      memory: metrics.memory,
      eventLoop: metrics.eventLoop,
      process: metrics.process,
    });
  }, config.metricsIntervalMs);

  // Wire up load test stats broadcaster to Socket.IO
  LoadTestService.setStatsBroadcaster((data) => {
    io.emit('loadTestStats', data);
  });

  // Start server
  server.listen(port, () => {
    const cpuInfo = cpus();
    // Use process.stdout.write for Azure Log Stream compatibility
    process.stdout.write(`[PerfSimNode] Server running on http://localhost:${port}\n`);
    process.stdout.write(`[PerfSimNode] CPU cores reported: ${cpuInfo.length} (${cpuInfo[0]?.model || 'unknown'})\n`);

    EventLogService.info('SERVER_STARTED', `PerfSimNode server started on port ${port}`, {
      details: { port, metricsIntervalMs: config.metricsIntervalMs },
    });

    // -------------------------------------------------------------------
    // SIDECAR PROBE PROCESS
    //
    // WHY: The main Node.js process has a single event loop. When it's
    // blocked (event loop blocking simulation), it can't measure its own
    // latency. The sidecar runs as a SEPARATE OS process with its own
    // event loop, making HTTP requests to the main app to measure
    // response time externally.
    //
    // HOW IT WORKS:
    // 1. Fork a child process running probe-sidecar.ts
    // 2. Sidecar probes GET /api/metrics/probe every 100ms
    // 3. Sidecar sends latency results back via Node.js IPC channel
    // 4. Main process relays IPC messages to dashboard via Socket.IO
    //
    // RESILIENCE:
    // - Auto-restarts if sidecar crashes (with 2s delay)
    // - Graceful shutdown when main process exits
    //
    // PORTING NOTES:
    //   The sidecar can be any background process that makes HTTP GET
    //   requests to the main app and sends results back:
    //   - Java: Separate thread with HttpClient + shared queue
    //   - Python: subprocess or separate asyncio task
    //   - C#: BackgroundService with HttpClient
    //   The critical requirement is that it runs on a SEPARATE thread/process
    //   so it can measure latency even when the main thread is blocked.
    // -------------------------------------------------------------------
    const sidecarScript = path.join(__dirname, 'sidecar', 'probe-sidecar.js');
    // For ts-node-dev, use the .ts source directly
    const sidecarSource = path.join(__dirname, 'sidecar', 'probe-sidecar.ts');
    const fs = require('fs');
    const scriptToRun = fs.existsSync(sidecarScript) ? sidecarScript : sidecarSource;

    let sidecarProcess: ChildProcess | null = null;

    const startSidecar = () => {
      const execArgv = scriptToRun.endsWith('.ts')
        ? ['--require', 'ts-node/register']
        : [];

      sidecarProcess = fork(scriptToRun, [], {
        env: {
          ...process.env,
          MAIN_APP_PORT: String(port),
          PROBE_INTERVAL_MS: '100',
          PROBE_TIMEOUT_MS: '10000',
          WEBSITE_HOSTNAME: process.env.WEBSITE_HOSTNAME || '',
        },
        execArgv,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      // Forward sidecar stdout/stderr with prefix
      sidecarProcess.stdout?.on('data', (data: Buffer) => {
        process.stdout.write(data.toString());
      });
      sidecarProcess.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(data.toString());
      });

      // Relay IPC messages from sidecar to dashboard via main Socket.IO
      sidecarProcess.on('message', (msg: { type: string; [key: string]: unknown }) => {
        if (msg.type === 'sidecarProbe') {
          io.emit('sidecarProbe', msg);
        }
      });

      sidecarProcess.on('exit', (code, signal) => {
        console.log(`[PerfSimNode] Sidecar exited (code: ${code}, signal: ${signal})`);
        // Restart sidecar after a brief delay unless main process is shutting down
        if (!isShuttingDown) {
          setTimeout(() => {
            console.log('[PerfSimNode] Restarting sidecar...');
            startSidecar();
          }, 2000);
        }
      });

      sidecarProcess.on('error', (err) => {
        console.error(`[PerfSimNode] Sidecar error: ${err.message}`);
      });

      console.log(`[PerfSimNode] Sidecar probe process started (PID: ${sidecarProcess.pid})`);
    };

    let isShuttingDown = false;

    // Graceful shutdown - kill sidecar when main process exits
    const shutdownSidecar = () => {
      isShuttingDown = true;
      if (sidecarProcess && !sidecarProcess.killed) {
        sidecarProcess.kill('SIGTERM');
      }
    };
    process.on('SIGTERM', shutdownSidecar);
    process.on('SIGINT', shutdownSidecar);
    process.on('exit', shutdownSidecar);

    startSidecar();
    
    // Log probe stats every 60 seconds
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    setInterval(() => {
      const probeMode = websiteHostname ? 'external (through frontend)' : 'localhost';
      console.log(`[PerfSimNode] Sidecar running, probing ${probeMode}`);
    }, 60000);
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
