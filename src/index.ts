/**
 * Application Entry Point
 *
 * Starts the Performance Problem Simulator server with Socket.IO support.
 *
 * @module index
 */

import http from 'http';
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

    // Server-side health probe every 100ms - generates real HTTP traffic for AppLens
    // and broadcasts measured latency to connected dashboards
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    
    console.log(`[PerfSimNode] WEBSITE_HOSTNAME: ${websiteHostname || 'not set'}`);
    console.log(`[PerfSimNode] App listening on port: ${port}`);
    
    let probeSuccessCount = 0;
    let probeErrorCount = 0;
    
    // For Azure App Service traffic to appear in AppLens, requests must go through
    // the front-end proxy. On Linux App Service, try HTTP to port 80 which goes
    // through the middleware proxy.
    
    console.log(`[PerfSimNode] Attempting probe through internal middleware on port 80`);
    
    setInterval(() => {
      const startTime = Date.now();
      
      if (websiteHostname) {
        // Try HTTP request to localhost:80 (Azure's internal middleware/proxy)
        // This should go through the front-end and appear in AppLens
        const requestOptions: http.RequestOptions = {
          hostname: '127.0.0.1',
          port: 80,  // Azure's internal HTTP proxy port
          path: '/api/metrics/probe',
          method: 'GET',
          headers: {
            'Host': websiteHostname,  // Required for proper routing
            'User-Agent': 'PerfSimNode-Probe/1.0',
            'Connection': 'close',
            'X-Forwarded-Proto': 'https',  // Indicate this should be treated as HTTPS
          },
          timeout: 5000,
        };
        
        const req = http.request(requestOptions, (res) => {
          res.on('data', () => {}); // Consume response
          res.on('end', () => {
            probeSuccessCount++;
            const latencyMs = Date.now() - startTime;
            io.emit('probeLatency', { latencyMs, timestamp: Date.now() });
          });
        });
        
        req.on('error', (err) => {
          probeErrorCount++;
          if (probeErrorCount <= 10 || probeErrorCount % 100 === 0) {
            console.error(`[PerfSimNode] Probe error #${probeErrorCount}: ${err.message}`);
          }
          // Emit error latency so UI shows connection issues
          io.emit('probeLatency', { latencyMs: -1, timestamp: Date.now(), error: true });
        });
        req.on('timeout', () => {
          req.destroy();
          probeErrorCount++;
        });
        req.end();
      } else {
        // Local: Use HTTP to app port directly
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
      }
    }, 100);
    
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
