/**
 * Application Entry Point
 *
 * Starts the Performance Problem Simulator server with Socket.IO support.
 *
 * @module index
 */

import http from 'http';
import { exec } from 'child_process';
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
    console.log(`[PerfSimNode] Server running on http://localhost:${port}`);
    console.log(`[PerfSimNode] Dashboard: http://localhost:${port}`);
    console.log(`[PerfSimNode] API Health: http://localhost:${port}/api/health`);
    console.log(`[PerfSimNode] Metrics broadcast interval: ${config.metricsIntervalMs}ms`);

    EventLogService.info('SERVER_STARTED', `PerfSimNode server started on port ${port}`, {
      details: { port, metricsIntervalMs: config.metricsIntervalMs },
    });

    // Server-side health probe every 100ms - measures latency and broadcasts to dashboards
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    
    console.log(`[PerfSimNode] WEBSITE_HOSTNAME: ${websiteHostname || 'not set'}`);
    
    let probeSuccessCount = 0;
    let probeErrorCount = 0;
    
    if (websiteHostname) {
      // On Azure: Use curl to make external HTTP requests
      // curl goes through the standard network stack and should appear in AppLens
      const curlUrl = `https://${websiteHostname}/api/metrics/probe`;
      console.log(`[PerfSimNode] Using curl for probes: ${curlUrl}`);
      
      setInterval(() => {
        // Use curl with timing output - curl measures total request time
        exec(`curl -s -o /dev/null -w "%{time_total}" "${curlUrl}"`, { timeout: 5000 }, (error, stdout) => {
          if (error) {
            probeErrorCount++;
            if (probeErrorCount <= 5 || probeErrorCount % 100 === 0) {
              console.error(`[PerfSimNode] Curl probe error #${probeErrorCount}: ${error.message}`);
            }
          } else {
            probeSuccessCount++;
            // curl returns time in seconds with decimals, convert to ms
            const curlTimeSeconds = parseFloat(stdout.trim());
            const latencyMs = Math.round(curlTimeSeconds * 1000);
            io.emit('probeLatency', { latencyMs, timestamp: Date.now() });
          }
        });
      }, 100);
    } else {
      // Local: Use Node's http module directly
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
        req.on('error', () => {});
        req.on('timeout', () => req.destroy());
      }, 100);
    }
    
    // Log probe stats every 60 seconds
    setInterval(() => {
      console.log(`[PerfSimNode] Probe stats - Success: ${probeSuccessCount}, Errors: ${probeErrorCount}`);
    }, 60000);
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
