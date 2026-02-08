/**
 * Socket.IO Client Connection
 *
 * Manages WebSocket connection to the server for real-time metrics.
 */

// Socket.IO connection
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
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
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
  });

  socket.on('reconnect_attempt', (attempt) => {
    reconnectAttempts = attempt;
    statusEl.textContent = `Reconnecting (${attempt}/${maxReconnectAttempts})...`;
    statusEl.className = 'status-reconnecting';
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
