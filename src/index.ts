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
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
