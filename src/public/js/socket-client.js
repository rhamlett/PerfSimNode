/**
 * Socket.IO Client Connection
 *
 * Manages WebSocket connections to:
 * 1. Main app server - for metrics, events, and simulation updates
 * 2. Sidecar probe server - for accurate latency monitoring under load
 */

// Main app Socket.IO connection
let socket = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

// Sidecar Socket.IO connection
let sidecarSocket = null;
let isSidecarConnected = false;

/**
 * Initializes the Socket.IO connections (main app + sidecar).
 */
function initSocket() {
  const statusEl = document.getElementById('connection-status');

  // ------------------------------------------------------------------
  // Main app connection (same origin)
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // Sidecar probe connection (port + 1)
  // Runs on a separate process with its own event loop for accurate
  // latency measurement even when the main app is under heavy load.
  // ------------------------------------------------------------------
  const sidecarPort = parseInt(window.location.port || '3000', 10) + 1;
  const sidecarUrl = `${window.location.protocol}//${window.location.hostname}:${sidecarPort}`;

  sidecarSocket = io(sidecarUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: maxReconnectAttempts,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  sidecarSocket.on('connect', () => {
    isSidecarConnected = true;
    console.log('[Sidecar] Connected to sidecar probe server on port', sidecarPort);
  });

  sidecarSocket.on('disconnect', (reason) => {
    isSidecarConnected = false;
    console.log('[Sidecar] Disconnected:', reason);
  });

  sidecarSocket.on('error', (error) => {
    console.error('[Sidecar] Error:', error);
  });

  // Listen for sidecar probe results (replaces old probeLatency from main app)
  sidecarSocket.on('sidecarProbe', (data) => {
    if (typeof onProbeLatency === 'function') {
      onProbeLatency(data);
    }
  });

  // Listen for load test state changes detected by sidecar
  sidecarSocket.on('loadTestStateChange', (data) => {
    if (typeof onLoadTestStateChange === 'function') {
      onLoadTestStateChange(data);
    }
  });

  // Listen for sidecar status updates
  sidecarSocket.on('sidecarStatus', (data) => {
    console.log('[Sidecar] Status:', data);
    if (data.loadTestActive && typeof onLoadTestStateChange === 'function') {
      onLoadTestStateChange({ active: true, concurrent: data.loadTestConcurrent });
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
 * Gets the sidecar connection status.
 *
 * @returns {boolean} True if sidecar is connected
 */
function isSidecarSocketConnected() {
  return isSidecarConnected;
}

/**
 * Gets the socket instance.
 *
 * @returns {Socket} Socket.IO client instance
 */
function getSocket() {
  return socket;
}

// Initialize sockets when DOM is ready
document.addEventListener('DOMContentLoaded', initSocket);
