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
 *   4. Load Test Stats: LoadTestService stats → io.emit('loadTestStats') every 60s
 *   5. Load Test Latency: Individual request latency (1:10 sampling) → io.emit('loadTestLatency')
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
import { IdleTimeoutService } from './services/idle-timeout.service';

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

    // Send current idle status to newly connected clients immediately.
    // This ensures clients know the current state even if they missed
    // a prior state change broadcast (e.g., reconnecting to an idle server).
    const currentStatus = IdleTimeoutService.getStatus();
    socket.emit('idleStatus', currentStatus);
    console.log(`[Socket.IO] Sent initial idleStatus to ${socket.id}: isIdle=${currentStatus.isIdle}`);

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
    });

    // Handle explicit activity ping from frontend
    socket.on('activity', () => {
      IdleTimeoutService.recordActivity('user activity');
    });

    // Handle idle status request from frontend
    socket.on('getIdleStatus', () => {
      socket.emit('idleStatus', IdleTimeoutService.getStatus());
    });

    // Handle slow request state changes from frontend
    // Relays to sidecar to reduce probe frequency during profiling
    socket.on('slowRequestState', (data: { active: boolean; completed?: number; total?: number; activeCount?: number }) => {
      console.log(`[Socket.IO] Slow request state change: active=${data.active}`);
      io.emit('slowRequestState', data);  // Broadcast to all clients for overlay sync
      // Note: sidecar message is sent from a closure that captures sidecarProcess
      if (typeof (global as Record<string, unknown>).__notifySidecarSlowRequestState === 'function') {
        ((global as Record<string, unknown>).__notifySidecarSlowRequestState as (active: boolean) => void)(data.active);
      }
    });
  });

  // --------------------------------------------------------------------------
  // IDLE STATUS BROADCASTING SETUP
  // Wire IdleTimeoutService to broadcast idle state changes to all connected
  // clients. This allows the dashboard to update the connection indicator
  // to show "Idle" when probes are suspended.
  // --------------------------------------------------------------------------
  IdleTimeoutService.onStateChange((_isIdle) => {
    const status = IdleTimeoutService.getStatus();
    console.log(`[Socket.IO] Broadcasting idleStatus: isIdle=${status.isIdle}`);
    io.emit('idleStatus', status);
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

  // Wire up load test latency broadcaster to Socket.IO (1:10 sampling)
  // This sends sampled individual load test request latencies to the dashboard
  // latency monitor for visualization without flooding the display
  LoadTestService.setLatencyBroadcaster((latencyMs) => {
    io.emit('loadTestLatency', { latencyMs, timestamp: new Date().toISOString() });
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
          PROBE_INTERVAL_MS: String(config.healthProbeRateMs),
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
      sidecarProcess.on('message', (msg: { type: string; latencyMs?: number; [key: string]: unknown }) => {
        if (msg.type === 'sidecarProbe') {
          io.emit('sidecarProbe', msg);
          // Record probe latency for load test stats estimation
          if (typeof msg.latencyMs === 'number') {
            LoadTestService.recordProbeLatency(msg.latencyMs);
          }
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

      // Send current idle state to newly started sidecar immediately.
      // This is critical: without this, a sidecar that restarts while the app
      // is idle will start with isIdle=false and begin probing, falsely waking
      // the app from the user's perspective.
      const currentIsIdle = IdleTimeoutService.isIdle();
      if (currentIsIdle) {
        sidecarProcess.send({ type: 'idleStateChange', isIdle: true });
        console.log('[PerfSimNode] Sent current idle state to new sidecar: idle=true');
      }
    };

    let isShuttingDown = false;

    // Wire up idle state changes to sidecar process.
    // Registered ONCE outside of startSidecar to avoid callback accumulation on restarts.
    IdleTimeoutService.onStateChange((isIdle) => {
      if (sidecarProcess && sidecarProcess.connected) {
        sidecarProcess.send({ type: 'idleStateChange', isIdle });
      }
    });

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

    // Set up global function for socket handler to relay slow request state to sidecar
    (global as Record<string, unknown>).__notifySidecarSlowRequestState = (active: boolean) => {
      if (sidecarProcess && sidecarProcess.connected) {
        sidecarProcess.send({ type: 'slowRequestStateChange', slowRequestActive: active });
        console.log(`[PerfSimNode] Sent slow request state to sidecar: active=${active}`);
      }
    };

    // Start idle timeout monitoring
    IdleTimeoutService.start();
    
    // Log probe stats every 60 seconds
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    setInterval(() => {
      const probeMode = websiteHostname ? 'external (through frontend)' : 'localhost';
      const idleStatus = IdleTimeoutService.isIdle() ? ' (IDLE - probes suspended)' : '';
      console.log(`[PerfSimNode] Sidecar running, probing ${probeMode}${idleStatus}`);
    }, 60000);
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
