/**
 * Application Entry Point
 *
 * Starts the Performance Problem Simulator server with Socket.IO support.
 *
 * @module index
 */

import http from 'http';
import https from 'https';
import dns from 'dns';
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
    // On Azure, probe the public hostname so requests go through the front-end and appear in AppLens
    const websiteHostname = process.env.WEBSITE_HOSTNAME;
    
    console.log(`[PerfSimNode] WEBSITE_HOSTNAME: ${websiteHostname || 'not set'}`);
    
    let probeSuccessCount = 0;
    let probeErrorCount = 0;
    
    if (websiteHostname) {
      // First, do a DNS lookup to see what IP we're resolving to
      dns.resolve4(websiteHostname, (err, addresses) => {
        console.log(`[PerfSimNode] DNS resolve4 for ${websiteHostname}:`, err ? err.message : addresses);
      });
      dns.lookup(websiteHostname, (err, address, family) => {
        console.log(`[PerfSimNode] DNS lookup for ${websiteHostname}:`, err ? err.message : `${address} (IPv${family})`);
      });
    }
    
    // On Azure, try to resolve DNS externally to get the ARR IP
    // Use external DNS (Google's 8.8.8.8) to bypass any internal DNS routing
    const externalResolver = new dns.Resolver();
    externalResolver.setServers(['8.8.8.8', '8.8.4.4']);
    
    let resolvedIp: string | null = null;
    
    if (websiteHostname) {
      externalResolver.resolve4(websiteHostname, (err, addresses) => {
        if (!err && addresses.length > 0) {
          resolvedIp = addresses[0];
          console.log(`[PerfSimNode] External DNS resolved ${websiteHostname} to ${resolvedIp}`);
        } else {
          console.log(`[PerfSimNode] External DNS resolution failed: ${err?.message || 'no addresses'}`);
        }
      });
    }
    
    const probeUrl = websiteHostname 
      ? `https://${websiteHostname}/api/metrics/probe`
      : `http://localhost:${port}/api/metrics/probe`;
    
    console.log(`[PerfSimNode] Probe URL: ${probeUrl}`);
    
    setInterval(() => {
      const startTime = Date.now();
      
      if (websiteHostname) {
        // On Azure: Use HTTPS with the resolved external IP if available
        // This ensures traffic goes through ARR (Azure's front-end) and appears in AppLens
        const requestOptions: https.RequestOptions = {
          hostname: resolvedIp || websiteHostname, // Use external IP if resolved
          port: 443,
          path: '/api/metrics/probe',
          method: 'GET',
          headers: {
            'Host': websiteHostname, // Required for proper routing and SSL
            'User-Agent': 'PerfSimNode-Probe/1.0',
            'Connection': 'close',
          },
          // Disable connection reuse to ensure each request appears separately
          agent: false,
        };
        
        const req = https.request(requestOptions, (res) => {
          res.on('data', () => {}); // Consume response
          res.on('end', () => {
            probeSuccessCount++;
            const latencyMs = Date.now() - startTime;
            io.emit('probeLatency', { latencyMs, timestamp: Date.now() });
          });
        });
        
        req.on('error', (err) => {
          probeErrorCount++;
          if (probeErrorCount <= 5 || probeErrorCount % 100 === 0) {
            console.error(`[PerfSimNode] Probe error #${probeErrorCount}: ${err.message}`);
          }
        });
        req.on('timeout', () => req.destroy());
        req.setTimeout(5000);
        req.end();
      } else {
        // Local: Use HTTP
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
      console.log(`[PerfSimNode] Probe stats - Success: ${probeSuccessCount}, Errors: ${probeErrorCount}, ResolvedIP: ${resolvedIp || 'using hostname'}`);
    }, 60000);
  });
}

main().catch((error: Error) => {
  console.error('[PerfSimNode] Failed to start server:', error.message);
  process.exit(1);
});
