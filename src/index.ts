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
import { exec } from 'child_process';
import { cpus } from 'os';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { config } from './config';
import { MetricsService } from './services/metrics.service';
import { EventLogService } from './services/event-log.service';

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
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    EventLogService.info('CLIENT_CONNECTED', `WebSocket client connected`, {
      details: { socketId: socket.id },
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (${reason})`);
      EventLogService.info('CLIENT_DISCONNECTED', `WebSocket client disconnected`, {
        details: { socketId: socket.id, reason },
      });
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

  // Start server
  server.listen(port, () => {
    const cpuInfo = cpus();
    // Use process.stdout.write for Azure Log Stream compatibility
    process.stdout.write(`[PerfSimNode] Server running on http://localhost:${port}\n`);
    process.stdout.write(`[PerfSimNode] CPU cores reported: ${cpuInfo.length} (${cpuInfo[0]?.model || 'unknown'})\n`);

    EventLogService.info('SERVER_STARTED', `PerfSimNode server started on port ${port}`, {
      details: { port, metricsIntervalMs: config.metricsIntervalMs },
    });

    // Server-side health probes for latency monitoring
    // Hybrid approach: native http for low-overhead dashboard updates, curl for AppLens visibility
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    
    console.log(`[PerfSimNode] WEBSITE_HOSTNAME: ${websiteHostname || 'not set'}`);
    
    let probeSuccessCount = 0;
    let probeErrorCount = 0;
    let curlSuccessCount = 0;
    let curlErrorCount = 0;
    
    // Native HTTP probe every 250ms - low overhead, real-time dashboard updates
    setInterval(() => {
      const startTime = Date.now();
      const req = http.get(`http://localhost:${port}/api/metrics/probe`, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          probeSuccessCount++;
          const latencyMs = Date.now() - startTime;
          io.emit('probeLatency', { latencyMs, timestamp: Date.now() });
        });
      });
      req.on('error', () => { probeErrorCount++; });
      req.on('timeout', () => req.destroy());
    }, 250);
    
    // Curl probe every 1s - for AppLens visibility (only on Azure)
    if (websiteHostname) {
      const curlUrl = `https://${websiteHostname}/api/metrics/probe`;
      console.log(`[PerfSimNode] Using hybrid probing: native http every 250ms, curl every 1s`);
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
      console.log(`[PerfSimNode] Local mode: native http probes only (every 250ms)`);
    }
    
    // Log probe stats every 60 seconds
    setInterval(() => {
      const curlStats = websiteHostname ? `, Curl: ${curlSuccessCount}/${curlErrorCount}` : '';
      console.log(`[PerfSimNode] Probe stats - Native: ${probeSuccessCount}/${probeErrorCount}${curlStats}`);
    }, 60000);
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
