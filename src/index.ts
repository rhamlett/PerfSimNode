/**
 * Application Entry Point
 *
 * Starts the Performance Problem Simulator server with Socket.IO support.
 *
 * @module index
 */

// Initialize Azure Monitor OpenTelemetry FIRST - before any other imports
import './instrumentation';

import http from 'http';
import { exec, fork, ChildProcess } from 'child_process';
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
 */
async function main(): Promise<void> {
  const app = createApp();
  const port = config.port;

  // Create HTTP server
  const server = http.createServer(app);

  // Initialize Socket.IO
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

  // Set up event broadcasting via Socket.IO
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

  // Broadcast metrics at configured interval
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
    const sidecarPort = port + 1;
    // Use process.stdout.write for Azure Log Stream compatibility
    process.stdout.write(`[PerfSimNode] Server running on http://localhost:${port}\n`);
    process.stdout.write(`[PerfSimNode] CPU cores reported: ${cpuInfo.length} (${cpuInfo[0]?.model || 'unknown'})\n`);

    EventLogService.info('SERVER_STARTED', `PerfSimNode server started on port ${port}`, {
      details: { port, metricsIntervalMs: config.metricsIntervalMs },
    });

    // -------------------------------------------------------------------
    // Sidecar Probe Process
    // Runs on its own event loop for accurate latency monitoring under load
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
          SIDECAR_PORT: String(sidecarPort),
          PROBE_INTERVAL_MS: '100',
          PROBE_TIMEOUT_MS: '10000',
        },
        execArgv,
        stdio: 'pipe',
      });

      // Forward sidecar stdout/stderr with prefix
      sidecarProcess.stdout?.on('data', (data: Buffer) => {
        process.stdout.write(data.toString());
      });
      sidecarProcess.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(data.toString());
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

      console.log(`[PerfSimNode] Sidecar probe server started on port ${sidecarPort} (PID: ${sidecarProcess.pid})`);
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

    // -------------------------------------------------------------------
    // Curl probe for AppLens visibility (Azure only)
    // -------------------------------------------------------------------
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    console.log(`[PerfSimNode] WEBSITE_HOSTNAME: ${websiteHostname || 'not set'}`);

    let curlSuccessCount = 0;
    let curlErrorCount = 0;

    if (websiteHostname) {
      const curlUrl = `https://${websiteHostname}/api/metrics/probe`;
      console.log(`[PerfSimNode] Sidecar probing main app, curl every 1s for AppLens`);
      console.log(`[PerfSimNode] Curl URL for AppLens: ${curlUrl}`);
      
      setInterval(() => {
        exec(`curl -s -o /dev/null -w "%{time_total}" "${curlUrl}"`, { timeout: 5000 }, (error) => {
          if (error) {
            curlErrorCount++;
            if (curlErrorCount <= 5 || curlErrorCount % 100 === 0) {
              console.error(`[PerfSimNode] Curl probe error #${curlErrorCount}: ${error.message}`);
            }
          } else {
            curlSuccessCount++;
          }
        });
      }, 1000);
    } else {
      console.log(`[PerfSimNode] Local mode: sidecar probes only`);
    }
    
    // Log probe stats every 60 seconds
    setInterval(() => {
      const curlStats = websiteHostname ? `, Curl: ${curlSuccessCount}/${curlErrorCount}` : '';
      console.log(`[PerfSimNode] Sidecar port: ${sidecarPort}${curlStats}`);
    }, 60000);
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
