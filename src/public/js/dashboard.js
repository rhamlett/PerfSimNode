/**
 * Dashboard Logic
 *
 * Handles UI interactions and API calls for the dashboard.
 */

// Active simulations tracking
const activeSimulations = {
  cpu: new Map(),
  memory: new Map(),
};

// Event log entries
const eventLog = [];
const maxEventLogEntries = 100;

/**
 * Called when Socket.IO connection is established.
 */
function onSocketConnected() {
  console.log('[Dashboard] Socket connected, loading initial data');
  loadActiveSimulations();
  loadEventLog();
}

/**
 * Called when new metrics are received via WebSocket.
 */
function onMetricsUpdate(metrics) {
  // Update metric display values
  document.getElementById('cpu-value').textContent = metrics.cpu.usagePercent.toFixed(1);
  document.getElementById('memory-value').textContent = metrics.memory.heapUsedMb.toFixed(1);
  document.getElementById('eventloop-value').textContent = metrics.eventLoop.lagMs.toFixed(2);
  document.getElementById('rss-value').textContent = metrics.memory.rssMb.toFixed(1);

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
 * Adds an event to the log display.
 */
function addEventToLog(event) {
  eventLog.unshift(event);
  if (eventLog.length > maxEventLogEntries) {
    eventLog.pop();
  }
  renderEventLog();
}

/**
 * Renders the event log.
 */
function renderEventLog() {
  const container = document.getElementById('event-log');
  if (!container) return;

  container.innerHTML = eventLog
    .map((event) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      return `<div class="event-entry ${event.level}">
        <span class="event-time">[${time}]</span>
        <span class="event-type">${event.event}</span>:
        <span class="event-message">${event.message}</span>
      </div>`;
    })
    .join('');
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
  } catch (error) {
    console.error('[Dashboard] Failed to load simulations:', error);
  }
}

/**
 * Loads event log from the server.
 */
async function loadEventLog() {
  try {
    const response = await fetch('/api/admin/events?limit=50');
    const data = await response.json();

    eventLog.length = 0;
    eventLog.push(...data.events);
    renderEventLog();
  } catch (error) {
    console.error('[Dashboard] Failed to load event log:', error);
  }
}

/**
 * Renders active CPU simulations.
 */
function renderActiveCpuSimulations() {
  const container = document.getElementById('cpu-active');
  if (!container) return;

  if (activeSimulations.cpu.size === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = Array.from(activeSimulations.cpu.values())
    .map(
      (sim) => `
      <div class="active-simulation">
        <span>${sim.parameters.targetLoadPercent}% for ${sim.parameters.durationSeconds}s</span>
        <span class="sim-id">${sim.id.slice(0, 8)}...</span>
        <button class="btn-stop" onclick="stopCpuSimulation('${sim.id}')">Stop</button>
      </div>
    `
    )
    .join('');
}

/**
 * Renders active memory allocations.
 */
function renderActiveMemorySimulations() {
  const container = document.getElementById('memory-active');
  if (!container) return;

  if (activeSimulations.memory.size === 0) {
    container.innerHTML = '';
    return;
  }

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

/**
 * Starts a CPU stress simulation.
 */
async function startCpuStress(targetLoadPercent, durationSeconds) {
  try {
    const response = await fetch('/api/simulations/cpu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLoadPercent, durationSeconds }),
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
      parameters: { targetLoadPercent, durationSeconds },
    });
    renderActiveCpuSimulations();

    // Add event to log
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'SIMULATION_STARTED',
      message: `CPU stress started: ${targetLoadPercent}% for ${durationSeconds}s`,
    });
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

    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'MEMORY_ALLOCATED',
      message: `Allocated ${sizeMb}MB of memory`,
    });
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
    const response = await fetch(`/api/simulations/memory/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      alert(`Error: ${data.message}`);
      return;
    }

    activeSimulations.memory.delete(id);
    renderActiveMemorySimulations();
  } catch (error) {
    console.error('[Dashboard] Failed to release memory:', error);
    alert('Failed to release memory');
  }
}

/**
 * Triggers event loop blocking.
 */
async function blockEventLoop(durationSeconds) {
  try {
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event: 'SIMULATION_STARTED',
      message: `Blocking event loop for ${durationSeconds}s - server will be unresponsive`,
    });

    const response = await fetch('/api/simulations/eventloop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationSeconds }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(`Error: ${data.message}`);
      return;
    }

    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'SIMULATION_COMPLETED',
      message: `Event loop blocking completed after ${data.actualDurationMs}ms`,
    });
  } catch (error) {
    console.error('[Dashboard] Event loop blocking failed:', error);
  }
}

/**
 * Sends a slow request.
 */
async function sendSlowRequest(delaySeconds) {
  const statusEl = document.getElementById('slow-status');
  if (statusEl) {
    statusEl.textContent = `Waiting ${delaySeconds}s...`;
  }

  try {
    const response = await fetch(`/api/simulations/slow?delaySeconds=${delaySeconds}`);
    const data = await response.json();

    if (statusEl) {
      statusEl.textContent = `Completed in ${data.actualDurationMs}ms`;
    }
  } catch (error) {
    console.error('[Dashboard] Slow request failed:', error);
    if (statusEl) {
      statusEl.textContent = 'Request failed';
    }
  }
}

/**
 * Triggers a crash (exception).
 */
async function crashException() {
  if (!confirm('This will crash the server! Are you sure?')) {
    return;
  }

  try {
    await fetch('/api/simulations/crash/exception', { method: 'POST' });
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'SIMULATION_STARTED',
      message: 'Crash initiated via unhandled exception',
    });
  } catch (error) {
    console.error('[Dashboard] Crash request failed:', error);
  }
}

/**
 * Triggers a crash (memory exhaustion).
 */
async function crashMemory() {
  if (!confirm('This will crash the server via OOM! Are you sure?')) {
    return;
  }

  try {
    await fetch('/api/simulations/crash/memory', { method: 'POST' });
    addEventToLog({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'SIMULATION_STARTED',
      message: 'Crash initiated via memory exhaustion',
    });
  } catch (error) {
    console.error('[Dashboard] Crash request failed:', error);
  }
}

// Form handlers
document.addEventListener('DOMContentLoaded', () => {
  // CPU Form
  const cpuForm = document.getElementById('cpu-form');
  if (cpuForm) {
    cpuForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(cpuForm);
      startCpuStress(
        parseInt(formData.get('targetLoadPercent')),
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

  // Event Loop Form
  const eventloopForm = document.getElementById('eventloop-form');
  if (eventloopForm) {
    eventloopForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(eventloopForm);
      blockEventLoop(parseInt(formData.get('durationSeconds')));
    });
  }

  // Slow Request Form
  const slowForm = document.getElementById('slow-form');
  if (slowForm) {
    slowForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(slowForm);
      sendSlowRequest(parseInt(formData.get('delaySeconds')));
    });
  }

  // Crash Buttons
  const crashExceptionBtn = document.getElementById('crash-exception');
  if (crashExceptionBtn) {
    crashExceptionBtn.addEventListener('click', crashException);
  }

  const crashMemoryBtn = document.getElementById('crash-memory');
  if (crashMemoryBtn) {
    crashMemoryBtn.addEventListener('click', crashMemory);
  }

  // Initial data load (fallback if socket isn't ready)
  setTimeout(() => {
    if (!isSocketConnected()) {
      loadActiveSimulations();
      loadEventLog();
      // Poll for metrics if WebSocket isn't available
      setInterval(pollMetrics, 1000);
    }
  }, 2000);
});

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
