/**
 * =============================================================================
 * SOCKET.IO CLIENT — WebSocket Connection Manager
 * =============================================================================
 *
 * PURPOSE:
 *   Manages the WebSocket connection from the browser to the main server.
 *   All real-time data flows through this single connection:
 *   - 'metrics'       → System metrics updates (~1/second)
 *   - 'event'         → Event log entries (simulation start/stop, errors)
 *   - 'simulation'    → Simulation state changes (started/completed/failed)
 *   - 'sidecarProbe'  → Latency probe results from the sidecar process
 *
 * SCRIPT LOADING ORDER:
 *   This file must be loaded BEFORE dashboard.js and charts.js in index.html.
 *   It defines callback hooks (onSocketConnected, onMetricsUpdate, etc.) that
 *   those files implement. This is a simple dependency injection via globals.
 *
 * CONNECTION STRATEGY:
 *   - Uses WebSocket transport directly (skips HTTP long-polling fallback)
 *   - Auto-reconnects with exponential backoff up to 10 attempts
 *   - 60-second timeout matches server-side Socket.IO pingTimeout
 *
 * PORTING NOTES:
 *   When porting to another stack, the frontend WebSocket layer remains
 *   JavaScript regardless of the backend language. However:
 *   - Java/Spring: Use SockJS + STOMP client instead of Socket.IO
 *   - Python/FastAPI: Use native WebSocket API or socket.io-client
 *   - C#/SignalR: Use @microsoft/signalr client library
 *   - PHP/Ratchet: Use native WebSocket API
 *   Each framework has its own real-time messaging protocol.
 */

// Main app Socket.IO connection
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

/**
 * Initializes the Socket.IO connection.
 */
function initSocket() {
  const statusEl = document.getElementById('connection-status');

  socket = io({
    // Use WebSocket directly, skip long-polling
    transports: ['websocket'],
    // Reconnection settings
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // Match server timeout settings
    timeout: 60000,
  });

  socket.on('connect', () => {
    isConnected = true;
    reconnectAttempts = 0;
    statusEl.textContent = 'Connected';
    statusEl.className = 'status-connected';
    console.log('[Socket] Connected to server');

    // Notify dashboard of connection
    if (typeof onSocketConnected === 'function') {
      onSocketConnected();
    }
  });

  socket.on('disconnect', (reason) => {
    isConnected = false;
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status-disconnected';
    console.log('[Socket] Disconnected:', reason);
    
    // Log disconnection to event log
    if (typeof addEventToLog === 'function') {
      addEventToLog({ level: 'warning', message: 'Connection lost. Attempting to reconnect...' });
    }
  });

  socket.on('reconnect_attempt', (attempt) => {
    reconnectAttempts = attempt;
    statusEl.textContent = `Reconnecting (${attempt}/${maxReconnectAttempts})...`;
    statusEl.className = 'status-reconnecting';
  });

  socket.on('reconnect', () => {
    // Log reconnection to event log
    if (typeof addEventToLog === 'function') {
      addEventToLog({ level: 'success', message: 'Reconnected to server' });
    }
  });

  socket.on('reconnect_failed', () => {
    statusEl.textContent = 'Connection Failed';
    statusEl.className = 'status-disconnected';
    console.error('[Socket] Failed to reconnect after', maxReconnectAttempts, 'attempts');
  });

  socket.on('error', (error) => {
    console.error('[Socket] Error:', error);
  });

  // Listen for metrics updates
  socket.on('metrics', (metrics) => {
    if (typeof onMetricsUpdate === 'function') {
      onMetricsUpdate(metrics);
    }
  });

  // Listen for event log updates
  socket.on('event', (event) => {
    if (typeof onEventUpdate === 'function') {
      onEventUpdate(event);
    }
  });

  // Listen for simulation updates
  socket.on('simulation', (simulation) => {
    if (typeof onSimulationUpdate === 'function') {
      onSimulationUpdate(simulation);
    }
  });

  // Listen for sidecar probe results (relayed from sidecar via IPC)
  socket.on('sidecarProbe', (data) => {
    if (typeof onProbeLatency === 'function') {
      onProbeLatency(data);
    }
  });
}

/**
 * Gets the current connection status.
 *
 * @returns {boolean} True if connected
 */
function isSocketConnected() {
  return isConnected;
}

/**
 * Gets the socket instance.
 *
 * @returns {Socket} Socket.IO client instance
 */
function getSocket() {
  return socket;
}

// Initialize socket when DOM is ready
document.addEventListener('DOMContentLoaded', initSocket);
