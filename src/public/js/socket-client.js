/**
 * =============================================================================
 * SOCKET.IO CLIENT — WebSocket Connection Manager
 * =============================================================================
 *
 * PURPOSE:
 *   Manages the WebSocket connection from the browser to the main server.
 *   All real-time data flows through this single connection:
 *   - 'metrics'         → System metrics updates (~1/second)
 *   - 'event'           → Event log entries (simulation start/stop, errors)
 *   - 'simulation'      → Simulation state changes (started/completed/failed)
 *   - 'sidecarProbe'    → Latency probe results from the sidecar process
 *   - 'loadTestLatency' → Sampled load test request latencies (1:10 sampling)
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

// When true, the WebSocket was closed intentionally (idle transition).
// Suppresses disconnect status indicator updates and prevents auto-reconnect.
let intentionalDisconnect = false;

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
    intentionalDisconnect = false;
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
    console.log('[Socket] Disconnected:', reason);

    // Intentional disconnect (idle transition) — do not update status or reconnect
    if (intentionalDisconnect) {
      return;
    }

    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status-disconnected';
    
    // Log disconnection to event log
    if (typeof addEventToLog === 'function') {
      addEventToLog({ level: 'warning', message: 'Connection lost. Attempting to reconnect...' });
    }
  });

  // Reconnection events are emitted by the Manager (socket.io), not the Socket instance
  socket.io.on('reconnect_attempt', (attempt) => {
    if (intentionalDisconnect) return;
    reconnectAttempts = attempt;
    statusEl.textContent = `Reconnecting (${attempt}/${maxReconnectAttempts})...`;
    statusEl.className = 'status-reconnecting';
  });

  socket.io.on('reconnect', () => {
    console.log('[Socket] Reconnected to server');
    // Log reconnection to event log
    if (typeof addEventToLog === 'function') {
      addEventToLog({ level: 'success', message: 'Reconnected to server' });
    }
  });

  socket.io.on('reconnect_failed', () => {
    if (intentionalDisconnect) return;
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

  // Listen for load test latency samples (1:10 sampling)
  // These are individual load test request latencies sent to the latency monitor
  socket.on('loadTestLatency', (data) => {
    if (typeof onLoadTestLatency === 'function') {
      onLoadTestLatency(data);
    }
  });

  // Listen for idle status updates from the server
  socket.on('idleStatus', (data) => {
    console.log('[Socket] Received idleStatus:', data);
    if (typeof onIdleStatusUpdate === 'function') {
      onIdleStatusUpdate(data);
    } else {
      console.warn('[Socket] onIdleStatusUpdate is not defined!');
    }
  });

  // Listen for slow request state updates from the server
  // This syncs the overlay state across all connected dashboards
  socket.on('slowRequestState', (data) => {
    console.log('[Socket] Received slowRequestState:', data);
    if (typeof onSlowRequestStateUpdate === 'function') {
      onSlowRequestStateUpdate(data);
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

/**
 * Sends an activity signal to the server.
 * Call this when the user interacts with the dashboard to prevent idle timeout.
 */
function sendActivity() {
  if (socket && isConnected) {
    socket.emit('activity');
  }
}

/**
 * Requests the current idle status from the server.
 */
function requestIdleStatus() {
  if (socket && isConnected) {
    socket.emit('getIdleStatus');
  }
}

/**
 * Sends slow request state to the server.
 * This notifies the sidecar to reduce probe frequency during profiling.
 * @param {boolean} active - Whether slow request simulation is active
 * @param {number} completed - Number of completed requests
 * @param {number} total - Total number of requests
 * @param {number} activeCount - Number of currently active requests
 */
function sendSlowRequestState(active, completed = 0, total = 0, activeCount = 0) {
  if (socket && isConnected) {
    socket.emit('slowRequestState', { active, completed, total, activeCount });
  }
}

/**
 * Intentionally closes the WebSocket during idle transition.
 * Sets the intentionalDisconnect flag so the onclose handler
 * does not update the status indicator or schedule a reconnect.
 */
function closeWebSocketForIdle() {
  intentionalDisconnect = true;
  if (socket) {
    socket.disconnect();
  }
}

/**
 * Ensures the WebSocket is connected. If closed or closing, reconnects.
 * Called at the top of every simulation trigger so that clicking a button
 * while idle automatically re-establishes the connection.
 */
function ensureWebSocket() {
  if (!socket) {
    intentionalDisconnect = false;
    initSocket();
    return;
  }
  if (socket.disconnected) {
    intentionalDisconnect = false;
    socket.connect();
  }
}

// Initialize socket when DOM is ready.
// An HTTP request fires first to wake the server from idle via the activity
// tracker middleware, so the first WebSocket broadcast has is_idle: false.
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await fetch('/api/health/probe', { cache: 'no-store' });
  } catch (e) {
    // Server may still be starting — socket will retry
  }
  initSocket();
});
