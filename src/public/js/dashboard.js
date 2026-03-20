/**
 * =============================================================================
 * DASHBOARD LOGIC — UI Interactions, API Calls, and State Management
 * =============================================================================
 *
 * PURPOSE:
 *   Main dashboard controller handling all user interactions, REST API calls,
 *   and UI state management. This is the largest frontend file and serves as
 *   the central coordinator between the UI, the REST API, and real-time updates.
 *
 * RESPONSIBILITIES:
 *   1. SIMULATION CONTROL: Start/stop CPU stress, allocate/release memory,
 *      trigger event loop blocking, send slow requests, trigger crashes
 *   2. UI RENDERING: Active simulation lists, event log, status badges,
 *      metric gauge values, impact measurements
 *   3. REAL-TIME HANDLERS: Callback implementations for WebSocket events
 *      (onSocketConnected, onMetricsUpdate, onEventUpdate, onSimulationUpdate)
 *   4. PROCESS RESTART DETECTION: Monitors process ID changes in metrics
 *      to detect and report application crashes/restarts
 *
 * API INTEGRATION PATTERN:
 *   Each simulation has a consistent UI flow:
 *   1. User fills form → submit handler validates input
 *   2. fetch() POST/GET/DELETE to /api/simulations/{type}
 *   3. Response updates local state (activeSimulations Map)
 *   4. UI re-renders via render*() functions
 *   5. WebSocket events may also trigger state updates (dual path)
 *
 * STATE MANAGEMENT:
 *   - activeSimulations.cpu: Map<id, SimulationInfo> for CPU simulations
 *   - activeSimulations.memory: Map<id, SimulationInfo> for memory allocations
 *   - eventLog: Array of log entries (clears on page refresh)
 *   - lastProcessId: For crash/restart detection
 *
 * PORTING NOTES:
 *   This file is FRONTEND JavaScript — it stays JavaScript regardless of
 *   backend language. However, when porting:
 *   - React/Vue/Angular: Convert to components with proper state management
 *   - The fetch() calls target REST endpoints whose paths don't change
 *   - The WebSocket event names must match whatever the backend emits
 *   - UTC time formatting is used throughout to match Azure diagnostics
 */

// Active simulations tracking
const activeSimulations = {
  cpu: new Map(),
  memory: new Map(),
};

// Event log entries (unlimited, clears on page refresh)
const eventLog = [];

// Track if initial load has happened
let initialLoadComplete = false;

/**
 * Returns a color based on metric value and thresholds.
 * @param {number} value - The metric value
 * @param {number} warningThreshold - Value at which to show yellow/warning
 * @param {number} dangerThreshold - Value at which to show red/danger
 * @returns {string} CSS color value
 */
function getMetricColor(value, warningThreshold, dangerThreshold) {
  if (value >= dangerThreshold) return '#d13438';  // Red
  if (value >= warningThreshold) return '#ffb900'; // Yellow
  return '';  // Default (inherit from CSS)
}

/**
 * Called when Socket.IO connection is established.
 */
function onSocketConnected() {
  console.log('[Dashboard] Socket connected, loading initial data');
  loadActiveSimulations();
  // Only load event log on initial connection to prevent clearing accumulated events
  if (!initialLoadComplete) {
    loadEventLog();
    initialLoadComplete = true;
  }
}

/**
 * Called when new metrics are received via WebSocket.
 */
function onMetricsUpdate(metrics) {
  // Check for application restart (process ID change)
  if (metrics.process && metrics.process.pid) {
    if (lastProcessId !== null && lastProcessId !== metrics.process.pid) {
      addEventToLog({
        level: 'danger',
        message: `APPLICATION RESTARTED! Process ID changed from ${lastProcessId} to ${metrics.process.pid}. This may indicate an unexpected crash (OOM, StackOverflow, etc.)`
      });
      // Clear active simulations since app restarted
      activeSimulations.cpu.clear();
      activeSimulations.memory.clear();
      renderActiveCpuSimulations();
      renderActiveMemorySimulations();
    }
    lastProcessId = metrics.process.pid;
  }

  // Update metric display values with stress-based colors
  const cpuEl = document.getElementById('cpu-value');
  cpuEl.textContent = metrics.cpu.usagePercent.toFixed(1);
  cpuEl.style.color = getMetricColor(metrics.cpu.usagePercent, 60, 80);

  const memoryEl = document.getElementById('memory-value');
  memoryEl.textContent = metrics.memory.heapUsedMb.toFixed(1);
  const totalMb = metrics.memory.totalSystemMb || 4096;
  const memoryPercent = (metrics.memory.heapUsedMb / totalMb) * 100;
  memoryEl.style.color = getMetricColor(memoryPercent, 60, 80);
  
  // Update total memory display
  const totalGb = (metrics.memory.totalSystemMb / 1024).toFixed(1);
  document.getElementById('memory-total').textContent = `of ${totalGb} GB`;

  // Use heartbeatLagMs for real-time event loop blocking visibility
  const eventloopEl = document.getElementById('eventloop-value');
  eventloopEl.textContent = metrics.eventLoop.heartbeatLagMs.toFixed(2);
  // Event loop: yellow at 100ms, red at 1000ms
  eventloopEl.style.color = getMetricColor(metrics.eventLoop.heartbeatLagMs, 100, 1000);

  const rssEl = document.getElementById('rss-value');
  rssEl.textContent = metrics.memory.rssMb.toFixed(1);
  const rssPercent = (metrics.memory.rssMb / totalMb) * 100;
  rssEl.style.color = getMetricColor(rssPercent, 60, 80);

  // Update charts
  if (typeof updateCharts === 'function') {
    updateCharts(metrics);
  }
}

/**
 * Called when a new event is received via WebSocket.
 */
function onEventUpdate(event) {
  addEventToLog(event);
}

/**
 * Called when a simulation status changes.
 */
function onSimulationUpdate(simulation) {
  if (simulation.type === 'CPU_STRESS') {
    if (simulation.status === 'ACTIVE') {
      activeSimulations.cpu.set(simulation.id, simulation);
    } else {
      activeSimulations.cpu.delete(simulation.id);
    }
    renderActiveCpuSimulations();
  } else if (simulation.type === 'MEMORY_PRESSURE') {
    if (simulation.status === 'ACTIVE') {
      activeSimulations.memory.set(simulation.id, simulation);
    } else {
      activeSimulations.memory.delete(simulation.id);
    }
    renderActiveMemorySimulations();
  }
}

/**
 * Called when idle status changes.
 * Updates the connection indicator to show idle state.
 */
function onIdleStatusUpdate(status) {
  console.log('[Dashboard] Idle status received:', JSON.stringify(status));
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) {
    console.error('[Dashboard] connection-status element not found!');
    return;
  }

  if (status.isIdle) {
    console.log('[Dashboard] Setting status to Idle');
    statusEl.textContent = 'Idle';
    statusEl.className = 'status-idle';
  } else {
    console.log('[Dashboard] Setting status to Connected');
    // Restore to connected state when no longer idle
    statusEl.textContent = 'Connected';
    statusEl.className = 'status-connected';
  }
}

/**
 * Called when slow request state changes (synced from server).
 * Updates the overlay to reflect the current slow request testing state.
 * This ensures all connected dashboards show the same overlay.
 */
function onSlowRequestStateUpdate(data) {
  console.log('[Dashboard] Slow request state received:', JSON.stringify(data));
  const statusEl = document.getElementById('slow-status');
  if (!statusEl) return;

  if (data.active) {
    statusEl.innerHTML = `
      <div class="slow-status-message">Latency probes reduced during Slow Request testing to ensure clean Node.js Profiler diagnostics.</div>
      <div class="slow-status-progress">Running: ${data.completed || 0}/${data.total || 0} completed, ${data.activeCount || 0} active</div>
    `;
    statusEl.className = 'slow-status active';
  } else if (!slowRequestRunning) {
    // Only clear if we're not running locally (avoid race conditions)
    statusEl.innerHTML = '';
    statusEl.className = 'slow-status';
  }
}

/**
 * Gets the current UTC time as a formatted string (HH:MM:SS)
 * All times use UTC to match Azure diagnostics data.
 */
function formatUtcTime(date) {
  if (!date || !(date instanceof Date)) date = new Date();
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

// Track last known process ID for restart detection
let lastProcessId = null;

/**
 * Adds an event to the log display.
 * @param {Object} event - Event object with level, message, and optional timestamp
 * @param {boolean} skipRender - If true, skip rendering (for batch operations)
 */
function addEventToLog(event, skipRender = false) {
  // Simple event format: { level, message } or full format with timestamp
  const logEntry = {
    timestamp: event.timestamp || new Date().toISOString(),
    level: event.level || 'info',
    message: event.message || (event.event ? `${event.event}: ${event.message}` : ''),
    simulationType: event.simulationType || null,
    eventType: event.event || null
  };
  
  eventLog.unshift(logEntry);
  if (!skipRender) {
    renderEventLog();
  }
}

/**
 * Gets the icon and CSS class for an event based on its simulation type.
 * @param {Object} event - Event object with simulationType, eventType, and message
 * @returns {Object} Object with icon (emoji) and colorClass properties
 */
function getEventIconAndClass(event) {
  const message = event.message || '';
  
  // Check for application restart/PID change
  if (message.includes('RESTARTED') || message.includes('Process ID changed')) {
    return { icon: '🔄', colorClass: 'restart' };
  }
  
  // Check for load test stats and error injection
  if (event.eventType === 'LOAD_TEST_STATS' || event.eventType === 'LOAD_TEST_ERROR_INJECTED') {
    return { icon: '📈', colorClass: 'loadtest' };
  }
  
  // Check for failed request errors
  if (event.eventType === 'FAILED_REQUEST_ERROR') {
    return { icon: '❌', colorClass: 'failed' };
  }
  
  // Map simulation types to icons and color classes
  const simType = event.simulationType;
  if (simType) {
    if (simType === 'CPU_STRESS') {
      return { icon: '🔥', colorClass: 'cpu' };
    }
    if (simType === 'MEMORY_PRESSURE') {
      return { icon: '📊', colorClass: 'memory' };
    }
    if (simType === 'EVENT_LOOP_BLOCKING') {
      return { icon: '🧵', colorClass: 'eventloop' };
    }
    if (simType === 'SLOW_REQUEST') {
      return { icon: '🐌', colorClass: 'slow' };
    }
    if (simType === 'FAILED_REQUEST') {
      return { icon: '❌', colorClass: 'failed' };
    }
    if (simType.startsWith('CRASH_')) {
      return { icon: '💥', colorClass: 'crash' };
    }
  }
  
  // Connection events and system messages - no icon, use default level color
  return { icon: '', colorClass: event.level };
}

/**
 * Renders the event log with UTC timestamps matching Azure diagnostics.
 * Always sorts by timestamp descending to ensure correct order.
 */
function renderEventLog() {
  const container = document.getElementById('event-log');
  if (!container) return;

  // Sort by timestamp descending (newest first) before rendering
  eventLog.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  container.innerHTML = eventLog
    .map((event) => {
      const time = formatUtcTime(new Date(event.timestamp));
      const { icon, colorClass } = getEventIconAndClass(event);
      const iconPart = icon ? `${icon} ` : '';
      return `<div class="log-entry ${colorClass}">
        <span class="log-time">${time} UTC</span>
        <span class="log-message">${iconPart}${event.message}</span>
      </div>`;
    })
    .join('');
}

/**
 * Copies the event log content to clipboard.
 */
function copyEventLog() {
  const btn = document.getElementById('copy-event-log-btn');
  if (!btn) return;

  // Build text content from eventLog array
  const textContent = eventLog
    .map((event) => {
      const time = formatUtcTime(new Date(event.timestamp));
      const { icon } = getEventIconAndClass(event);
      const iconPart = icon ? `${icon} ` : '';
      return `${time} UTC  ${iconPart}${event.message}`;
    })
    .join('\n');

  navigator.clipboard.writeText(textContent).then(() => {
    // Show success feedback
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<span class="copy-icon">✓</span> Copied!';
    btn.classList.add('copied');

    // Reset after 2 seconds
    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.classList.remove('copied');
    }, 2000);
  }).catch((err) => {
    console.error('[Dashboard] Failed to copy event log:', err);
  });
}

/**
 * Loads active simulations from the server.
 */
async function loadActiveSimulations() {
  try {
    const response = await fetch('/api/simulations');
    const data = await response.json();

    // Clear and repopulate
    activeSimulations.cpu.clear();
    activeSimulations.memory.clear();

    for (const sim of data.simulations) {
      if (sim.type === 'CPU_STRESS') {
        activeSimulations.cpu.set(sim.id, sim);
      } else if (sim.type === 'MEMORY_PRESSURE') {
        activeSimulations.memory.set(sim.id, sim);
      }
    }

    renderActiveCpuSimulations();
    renderActiveMemorySimulations();
    renderActiveSimulationsList();
  } catch (error) {
    console.error('[Dashboard] Failed to load simulations:', error);
  }
}

/**
 * Clears the event log on page load.
 * Event log starts fresh each session to show only current session events.
 */
async function loadEventLog() {
  // Clear all events - start fresh each browser session
  eventLog.length = 0;
  
  // Add startup messages
  addEventToLog({ level: 'success', message: 'Connected to metrics hub' }, true);
  
  // Fetch config for probe rate and idle timeout
  let probeRate = 200;
  let idleTimeout = 20;
  try {
    const configResponse = await fetch('/api/admin/config');
    const configData = await configResponse.json();
    probeRate = configData.latencyProbeIntervalMs || 200;
    idleTimeout = configData.idleTimeoutMinutes || 20;
  } catch (error) {
    console.log('[Dashboard] Could not load config values for event log');
  }
  addEventToLog({ level: 'info', message: `Dashboard initialized (probe rate: ${probeRate}ms, idle timeout: ${idleTimeout}m)` }, true);
  
  // Add environment info message
  try {
    const response = await fetch('/api/health/environment');
    const env = await response.json();
    let envMessage;
    if (env.isAzure && env.computerName) {
      envMessage = `Application is currently running on ${env.sku} SKU on worker ${env.computerName}`;
    } else if (env.isAzure) {
      envMessage = `Application is currently running on ${env.sku} SKU`;
    } else {
      envMessage = 'Application is currently running on Local';
    }
    addEventToLog({ level: 'info', message: envMessage }, true);
  } catch (error) {
    console.log('[Dashboard] Could not load environment info for event log');
  }
  
  renderEventLog();
}

/**
 * Renders active CPU simulations.
 */
function renderActiveCpuSimulations() {
  const container = document.getElementById('cpu-active');
  
  if (container) {
    if (activeSimulations.cpu.size === 0) {
      container.innerHTML = '';
    } else {
      container.innerHTML = Array.from(activeSimulations.cpu.values())
        .map(
          (sim) => `
          <div class="active-simulation">
            <span>${sim.parameters.intensity} for ${sim.parameters.durationSeconds}s</span>
            <span class="sim-id">${sim.id.slice(0, 8)}...</span>
            <button class="btn-stop" onclick="stopCpuSimulation('${sim.id}')">Stop</button>
          </div>
        `
        )
        .join('');
    }
  }
  
  // Always update the main active simulations list
  renderActiveSimulationsList();
}

/**
 * Renders active memory allocations.
 */
function renderActiveMemorySimulations() {
  const container = document.getElementById('memory-active');
  
  if (container) {
    if (activeSimulations.memory.size === 0) {
      container.innerHTML = '';
    } else {
      container.innerHTML = Array.from(activeSimulations.memory.values())
        .map(
          (sim) => `
          <div class="active-simulation">
            <span>${sim.parameters.sizeMb}MB</span>
            <span class="sim-id">${sim.id.slice(0, 8)}...</span>
            <button class="btn-stop" onclick="releaseMemory('${sim.id}')">Release</button>
          </div>
        `
        )
        .join('');
    }
  }
  
  // Always update the main active simulations list
  renderActiveSimulationsList();
}

/**
 * Renders the main active simulations list in the dashboard.
 */
function renderActiveSimulationsList() {
  const container = document.getElementById('active-simulations-list');
  if (!container) return;

  const cpuSims = Array.from(activeSimulations.cpu.values());
  const memSims = Array.from(activeSimulations.memory.values());
  
  if (cpuSims.length === 0 && memSims.length === 0) {
    container.innerHTML = '<p class="no-simulations">No active simulations</p>';
    return;
  }

  const badges = [];
  
  // CPU simulation badges
  cpuSims.forEach(sim => {
    badges.push(`
      <div class="simulation-badge cpu">
        <span class="spinner"></span>
        <span>CPU Stress (${sim.parameters.intensity})</span>
      </div>
    `);
  });
  
  // Memory simulation badges
  memSims.forEach(sim => {
    badges.push(`
      <div class="simulation-badge memory">
        <span class="spinner"></span>
        <span>Memory (${sim.parameters.sizeMb}MB)</span>
      </div>
    `);
  });

  container.innerHTML = `<div class="simulations-list">${badges.join('')}</div>`;
}

/**
 * Starts a CPU stress simulation.
 */
async function startCpuStress(intensity, durationSeconds) {
  try {
    const response = await fetch('/api/simulations/cpu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intensity, durationSeconds }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    // Add to active simulations
    activeSimulations.cpu.set(data.id, {
      id: data.id,
      type: 'CPU_STRESS',
      status: 'ACTIVE',
      parameters: { intensity, durationSeconds },
    });
    renderActiveCpuSimulations();

    // Auto-remove simulation after duration completes
    // (backend broadcasts SIMULATION_COMPLETED event via WebSocket)
    setTimeout(() => {
      if (activeSimulations.cpu.has(data.id)) {
        activeSimulations.cpu.delete(data.id);
        renderActiveCpuSimulations();
      }
    }, durationSeconds * 1000);
  } catch (error) {
    console.error('[Dashboard] Failed to start CPU stress:', error);
    alert('Failed to start CPU stress simulation');
  }
}

/**
 * Stops a CPU stress simulation.
 */
async function stopCpuSimulation(id) {
  try {
    const response = await fetch(`/api/simulations/cpu/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      alert(`Error: ${data.message}`);
      return;
    }

    // Remove from active simulations
    activeSimulations.cpu.delete(id);
    renderActiveCpuSimulations();
  } catch (error) {
    console.error('[Dashboard] Failed to stop CPU stress:', error);
    alert('Failed to stop simulation');
  }
}

/**
 * Stops all active CPU stress simulations.
 */
async function stopAllCpuSimulations() {
  const ids = Array.from(activeSimulations.cpu.keys());
  if (ids.length === 0) {
    return;
  }
  
  for (const id of ids) {
    await stopCpuSimulation(id);
  }
}

/**
 * Allocates memory.
 */
async function allocateMemory(sizeMb) {
  try {
    const response = await fetch('/api/simulations/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sizeMb }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    // Add to active simulations
    activeSimulations.memory.set(data.id, {
      id: data.id,
      type: 'MEMORY_PRESSURE',
      status: 'ACTIVE',
      parameters: { sizeMb },
    });
    renderActiveMemorySimulations();
    // Backend broadcasts MEMORY_ALLOCATING and MEMORY_ALLOCATED events via WebSocket
  } catch (error) {
    console.error('[Dashboard] Failed to allocate memory:', error);
    alert('Failed to allocate memory');
  }
}

/**
 * Releases memory allocation.
 */
async function releaseMemory(id) {
  try {
    // Get the size before deleting for the log message
    const sim = activeSimulations.memory.get(id);
    const sizeMb = sim?.parameters?.sizeMb || 'unknown';

    const response = await fetch(`/api/simulations/memory/${id}`, {
      method: 'DELETE',
    });

    const data = await response.json();

    if (!response.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    // Remove from active simulations and update UI
    activeSimulations.memory.delete(id);
    renderActiveMemorySimulations();
    // Backend broadcasts MEMORY_RELEASED event via WebSocket
  } catch (error) {
    console.error('[Dashboard] Failed to release memory:', error);
    alert('Failed to release memory');
  }
}

/**
 * Triggers event loop blocking with impact measurement.
 */
async function blockEventLoop(durationSeconds, chunkMs) {
  const impactEl = document.getElementById('eventloop-impact');
  
  // Clear previous impact results
  if (impactEl) {
    impactEl.innerHTML = '<div class="impact-result">⏳ Starting event loop block...</div>';
  }
  
  // Record pre-block state
  const preBlockProbes = typeof serverResponsiveness !== 'undefined' 
    ? serverResponsiveness.probeHistory.length 
    : 0;
  const startTime = Date.now();
  
  try {
    // Backend broadcasts SIMULATION_STARTED event via WebSocket
    
    // Fire concurrent test requests to demonstrate queuing
    const concurrentRequests = [];
    for (let i = 0; i < 3; i++) {
      const reqStart = Date.now();
      concurrentRequests.push(
        fetch('/api/health/probe', { cache: 'no-store' })
          .then(() => ({ index: i, duration: Date.now() - reqStart, success: true }))
          .catch(() => ({ index: i, duration: Date.now() - reqStart, success: false }))
      );
    }

    // The main blocking request
    const body = { durationSeconds };
    if (chunkMs != null) body.chunkMs = chunkMs;
    const response = await fetch('/api/simulations/eventloop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const endTime = Date.now();
    const totalDuration = (endTime - startTime) / 1000;
    
    // Wait for concurrent requests to complete
    const concurrentResults = await Promise.all(concurrentRequests);

    const data = await response.json();

    if (!response.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    // Calculate impact metrics
    const avgConcurrentLatency = concurrentResults.reduce((sum, r) => sum + r.duration, 0) / concurrentResults.length;
    
    // Record each concurrent request latency to the chart so spikes are visible
    for (const result of concurrentResults) {
      if (typeof recordSlowRequestLatency === 'function') {
        recordSlowRequestLatency(result.duration);
      }
    }
    // Backend broadcasts SIMULATION_COMPLETED event via WebSocket
    
    // Show impact results
    if (impactEl) {
      impactEl.innerHTML = `
        <div class="impact-result">
          <strong>📊 Impact Analysis:</strong><br>
          • Server blocked: <b>${(data.actualDurationMs / 1000).toFixed(1)}s</b><br>
          • Concurrent requests queued: <b>${avgConcurrentLatency.toFixed(0)}ms</b> avg latency<br>
          • Total round-trip: <b>${totalDuration.toFixed(1)}s</b>
        </div>
      `;
    }
  } catch (error) {
    console.error('[Dashboard] Event loop blocking failed:', error);
    
    const errorMessage = error.message || String(error);
    
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      simulationType: 'EVENT_LOOP_BLOCKING',
      event: 'SIMULATION_FAILED',
      message: `Event loop block failed: ${errorMessage}`,
    });
    
    if (impactEl) {
      impactEl.innerHTML = `
        <div class="impact-result" style="border-left-color: var(--color-danger);">
          <strong>❌ Request failed</strong><br>
          ${errorMessage}<br>
          <small>Check browser console (F12) for details.</small>
        </div>
      `;
    }
  }
}

// Track slow request simulation state
let slowRequestRunning = false;
let slowRequestAbortController = null;
let slowRequestIntervalId = null;

/**
 * Gets a human-readable description of the blocking pattern.
 */
function getPatternDescription(pattern) {
  switch (pattern) {
    case 'libuv': return 'libuv thread pool saturation';
    case 'worker': return 'worker thread blocking';
    case 'setTimeout':
    default: return 'non-blocking setTimeout';
  }
}

/**
 * Sends slow requests with the specified parameters.
 * Requests are fired at the specified interval rate, allowing them to overlap.
 */
async function sendSlowRequests(delaySeconds, intervalSeconds, maxRequests, blockingPattern = 'setTimeout') {
  const statusEl = document.getElementById('slow-status');
  
  slowRequestRunning = true;
  slowRequestAbortController = new AbortController();
  
  const patternDesc = getPatternDescription(blockingPattern);
  
  // Notify server to reduce probe frequency during profiling
  if (typeof sendSlowRequestState === 'function') {
    sendSlowRequestState(true, 0, maxRequests, 0);
  }
  
  // Log simulation start
  addEventToLog({
    timestamp: new Date().toISOString(),
    level: 'info',
    simulationType: 'SLOW_REQUEST',
    message: `Starting Slow Request simulation: ${maxRequests} requests × ${delaySeconds}s delay @ ${intervalSeconds}s intervals (${patternDesc})`
  });
  
  let sentRequests = 0;
  let completedRequests = 0;
  let activeRequests = 0;
  let totalLatency = 0;
  const pendingRequests = [];
  
  // Update status display with overlay message
  const updateStatus = () => {
    if (statusEl) {
      statusEl.innerHTML = `
        <div class="slow-status-message">Latency probes reduced during Slow Request testing to ensure clean Node.js Profiler diagnostics.</div>
        <div class="slow-status-progress">Running: ${completedRequests}/${maxRequests} completed, ${activeRequests} active</div>
      `;
      statusEl.className = 'slow-status active';
    }
    // Notify server of updated progress
    if (typeof sendSlowRequestState === 'function') {
      sendSlowRequestState(true, completedRequests, maxRequests, activeRequests);
    }
  };
  
  // Function to send a single request
  const sendRequest = (requestNum) => {
    const requestStart = Date.now();
    activeRequests++;
    
    // Log request start
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      simulationType: 'SLOW_REQUEST',
      message: `Request ${requestNum}/${maxRequests} started (${delaySeconds}s delay, ${patternDesc})`
    });
    
    updateStatus();
    
    const requestPromise = fetch(`/api/simulations/slow?delaySeconds=${delaySeconds}&blockingPattern=${blockingPattern}`, {
      signal: slowRequestAbortController.signal
    })
      .then(response => response.json())
      .then(data => {
        const latency = Date.now() - requestStart;
        completedRequests++;
        activeRequests--;
        totalLatency += latency;
        
        // Record this latency in the chart
        if (typeof recordSlowRequestLatency === 'function') {
          recordSlowRequestLatency(latency);
        }
        
        // Log request completion with actual latency
        addEventToLog({
          timestamp: new Date().toISOString(),
          level: 'info',
          simulationType: 'SLOW_REQUEST',
          message: `Request ${requestNum}/${maxRequests} completed: ${(latency / 1000).toFixed(1)}s actual latency`
        });
        
        updateStatus();
      })
      .catch(error => {
        activeRequests--;
        if (error.name !== 'AbortError') {
          console.error('[Dashboard] Slow request failed:', error);
          addEventToLog({
            timestamp: new Date().toISOString(),
            level: 'error',
            simulationType: 'SLOW_REQUEST',
            message: `Request ${requestNum}/${maxRequests} failed: ${error.message}`
          });
        }
        updateStatus();
      });
    
    pendingRequests.push(requestPromise);
  };
  
  // Send first request immediately
  sentRequests++;
  sendRequest(sentRequests);
  
  // Set up interval to send remaining requests
  if (maxRequests > 1) {
    slowRequestIntervalId = setInterval(() => {
      if (!slowRequestRunning || sentRequests >= maxRequests) {
        clearInterval(slowRequestIntervalId);
        slowRequestIntervalId = null;
        return;
      }
      
      sentRequests++;
      sendRequest(sentRequests);
    }, intervalSeconds * 1000);
  }
  
  // Wait for all requests to complete or be aborted
  await Promise.allSettled(pendingRequests);
  
  // Wait a bit more for any stragglers (requests sent near the end)
  while (activeRequests > 0 && slowRequestRunning) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Cleanup
  if (slowRequestIntervalId) {
    clearInterval(slowRequestIntervalId);
    slowRequestIntervalId = null;
  }
  
  slowRequestRunning = false;
  slowRequestAbortController = null;
  
  // Notify server to restore normal probe frequency
  if (typeof sendSlowRequestState === 'function') {
    sendSlowRequestState(false, completedRequests, maxRequests, 0);
  }
  
  if (statusEl && !statusEl.innerHTML.includes('Stopped')) {
    const avgLatency = completedRequests > 0 ? (totalLatency / completedRequests / 1000).toFixed(1) : 0;
    statusEl.innerHTML = '';
    statusEl.className = 'slow-status';
    
    // Log completion summary
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      simulationType: 'SLOW_REQUEST',
      message: `Slow Request simulation complete: ${completedRequests}/${maxRequests} requests, avg latency ${avgLatency}s`
    });
  }
}

/**
 * Stops any running slow request simulation.
 */
function stopSlowRequests() {
  if (slowRequestRunning) {
    // Stop the interval that sends new requests
    if (slowRequestIntervalId) {
      clearInterval(slowRequestIntervalId);
      slowRequestIntervalId = null;
    }
    
    // Abort any pending requests
    if (slowRequestAbortController) {
      slowRequestAbortController.abort();
    }
    
    slowRequestRunning = false;
    
    // Notify server to restore normal probe frequency
    if (typeof sendSlowRequestState === 'function') {
      sendSlowRequestState(false, 0, 0, 0);
    }
    
    // Log the stop
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'warning',
      simulationType: 'SLOW_REQUEST',
      message: `Slow Request simulation stopped by user`
    });
    
    // Update status
    const statusEl = document.getElementById('slow-status');
    if (statusEl) {
      statusEl.innerHTML = 'Stopped by user';
      statusEl.className = 'slow-status';
    }
  }
}

/**
 * Triggers failed requests simulation.
 * @param {number} requestCount - Number of failed requests to generate
 */
async function triggerFailedRequests(requestCount) {
  try {
    // Add optimistic event log entry
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      simulationType: 'FAILED_REQUEST',
      event: 'SIMULATION_STARTED',
      message: `Starting failed request simulation: generating ${requestCount} HTTP 5xx errors...`
    });

    const response = await fetch('/api/simulations/failed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestCount }),
    });

    const data = await response.json();

    if (!response.ok) {
      addEventToLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        simulationType: 'FAILED_REQUEST',
        event: 'SIMULATION_FAILED',
        message: `Failed request simulation error: ${data.message || 'Unknown error'}`
      });
      return;
    }

    // Success - the server will broadcast individual error events via WebSocket
  } catch (error) {
    console.error('[Dashboard] Failed to trigger failed requests:', error);
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      simulationType: 'FAILED_REQUEST',
      event: 'SIMULATION_FAILED',
      message: `Failed request simulation error: ${error.message}`
    });
  }
}

/**
 * Triggers a crash with the specified type.
 * @param {string} crashType - The type of crash (failfast, stackoverflow, exception, oom)
 */
async function triggerCrash(crashType) {
  const crashDescriptions = {
    failfast: 'FailFast (SIGABRT)',
    stackoverflow: 'Stack Overflow',
    exception: 'Unhandled Exception',
    oom: 'Out of Memory'
  };
  
  const crashEndpoints = {
    failfast: '/api/simulations/crash/failfast',
    stackoverflow: '/api/simulations/crash/stackoverflow',
    exception: '/api/simulations/crash/exception',
    oom: '/api/simulations/crash/memory'
  };

  // Crash types that may not auto-recover on Azure App Service
  const requiresAzureRestart = ['stackoverflow', 'oom'];
  
  const description = crashDescriptions[crashType] || crashType;
  
  let confirmMessage = `This will TERMINATE the server via ${description}!\n\nAre you sure?`;
  
  if (requiresAzureRestart.includes(crashType)) {
    confirmMessage = `This will TERMINATE the server via ${description}!\n\n⚠️ WARNING: On Azure App Service, this crash type may not auto-recover.\nManual restart from Azure Portal may be required.\n\nAre you sure?`;
  }
  
  if (!confirm(confirmMessage)) {
    return;
  }

  try {
    // Log crash initiation before the request (in case connection is lost)
    addEventToLog({
      level: 'error',
      simulationType: 'CRASH_' + crashType.toUpperCase(),
      message: `CRASH: ${description} - Connection will be lost!`
    });
    
    await fetch(crashEndpoints[crashType], { method: 'POST' });
  } catch (error) {
    console.error('[Dashboard] Crash request failed:', error);
  }
}

// Form handlers
document.addEventListener('DOMContentLoaded', () => {
  // Side Panel Toggle
  const togglePanelBtn = document.getElementById('toggle-panel');
  const closePanel = document.getElementById('close-panel');
  const sidePanel = document.getElementById('simulation-panel');

  if (togglePanelBtn && sidePanel) {
    togglePanelBtn.addEventListener('click', () => {
      sidePanel.classList.add('open');
      document.body.classList.add('panel-open');
    });
  }

  if (closePanel && sidePanel) {
    closePanel.addEventListener('click', () => {
      sidePanel.classList.remove('open');
      document.body.classList.remove('panel-open');
    });
  }

  // Close panel on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidePanel && sidePanel.classList.contains('open')) {
      sidePanel.classList.remove('open');
      document.body.classList.remove('panel-open');
    }
  });

  // Close panel when clicking outside of it
  document.addEventListener('click', (e) => {
    if (sidePanel && sidePanel.classList.contains('open')) {
      // Check if click is outside the panel and not on the toggle button
      const isClickInsidePanel = sidePanel.contains(e.target);
      const isClickOnToggle = togglePanelBtn && togglePanelBtn.contains(e.target);
      
      if (!isClickInsidePanel && !isClickOnToggle) {
        sidePanel.classList.remove('open');
        document.body.classList.remove('panel-open');
      }
    }
  });

  // Copy Event Log Button
  const copyEventLogBtn = document.getElementById('copy-event-log-btn');
  if (copyEventLogBtn) {
    copyEventLogBtn.addEventListener('click', copyEventLog);
  }

  // CPU Form
  const cpuForm = document.getElementById('cpu-form');
  if (cpuForm) {
    cpuForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(cpuForm);
      startCpuStress(
        formData.get('intensity'),
        parseInt(formData.get('durationSeconds'))
      );
    });
  }

  // Memory Form
  const memoryForm = document.getElementById('memory-form');
  if (memoryForm) {
    memoryForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(memoryForm);
      allocateMemory(parseInt(formData.get('sizeMb')));
    });
  }

  // Release All Memory Button
  const releaseAllBtn = document.getElementById('release-all-memory');
  if (releaseAllBtn) {
    releaseAllBtn.addEventListener('click', async () => {
      const ids = Array.from(activeSimulations.memory.keys());
      for (const id of ids) {
        await releaseMemory(id);
      }
    });
  }

  // Event Loop Form
  const eventloopForm = document.getElementById('eventloop-form');
  if (eventloopForm) {
    eventloopForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(eventloopForm);
      const chunkMsValue = formData.get('chunkMs');
      blockEventLoop(
        parseInt(formData.get('durationSeconds')),
        chunkMsValue ? parseInt(chunkMsValue) : undefined
      );
    });
  }

  // Slow Request Form
  const slowForm = document.getElementById('slow-form');
  if (slowForm) {
    slowForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(slowForm);
      sendSlowRequests(
        parseInt(formData.get('delaySeconds')),
        parseInt(formData.get('intervalSeconds')),
        parseInt(formData.get('maxRequests')),
        formData.get('blockingPattern') || 'setTimeout'
      );
    });
  }
  
  // Stop Slow Requests Button
  const stopSlowBtn = document.getElementById('stop-slow-requests');
  if (stopSlowBtn) {
    stopSlowBtn.addEventListener('click', stopSlowRequests);
  }

  // Failed Request Form
  const failedForm = document.getElementById('failed-form');
  if (failedForm) {
    failedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(failedForm);
      triggerFailedRequests(parseInt(formData.get('requestCount')));
    });
  }

  // Crash Form
  const crashForm = document.getElementById('crash-form');
  if (crashForm) {
    crashForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(crashForm);
      triggerCrash(formData.get('crashType'));
    });
  }

  // Initial data load (fallback if socket isn't ready)
  setTimeout(() => {
    if (!isSocketConnected()) {
      loadActiveSimulations();
      if (!initialLoadComplete) {
        loadEventLog();
        initialLoadComplete = true;
      }
      // Poll for metrics if WebSocket isn't available
      setInterval(pollMetrics, 1000);
    }
  }, 2000);
  
  // Load environment info for SKU badge
  loadEnvironmentInfo();
  
  // Load build info for footer
  loadBuildInfo();
});

/**
 * Loads environment info and updates the SKU badge.
 */
async function loadEnvironmentInfo() {
  try {
    const response = await fetch('/api/health/environment');
    const env = await response.json();
    
    const badge = document.getElementById('sku-badge');
    if (badge) {
      badge.textContent = `SKU: ${env.sku}`;
      if (env.isAzure) {
        badge.classList.add('azure');
      }
    }
  } catch (error) {
    console.log('[Dashboard] Could not load environment info');
  }
}

/**
 * Loads footer info (credits and build time) from the server.
 */
async function loadBuildInfo() {
  try {
    const response = await fetch('/api/health/footer');
    const data = await response.json();
    
    const footerCredits = document.getElementById('footer-credits');
    if (footerCredits) {
      if (data.footer) {
        footerCredits.innerHTML = data.footer;
      } else {
        footerCredits.style.display = 'none';
      }
    }
    
    const buildInfo = document.getElementById('build-info');
    if (buildInfo) {
      buildInfo.textContent = `Build: ${data.buildTime}`;
    }
  } catch (error) {
    console.log('[Dashboard] Could not load footer info');
  }
}

/**
 * Polls metrics via HTTP (fallback when WebSocket unavailable).
 */
async function pollMetrics() {
  try {
    const response = await fetch('/api/metrics');
    const metrics = await response.json();
    onMetricsUpdate(metrics);
  } catch (error) {
    console.error('[Dashboard] Failed to poll metrics:', error);
  }
}
