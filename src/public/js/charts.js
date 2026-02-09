/**
 * Chart.js Integration
 *
 * Manages real-time metric charts using Chart.js.
 */

/**
 * Gets the current UTC time as a formatted string (HH:MM:SS)
 * All times use UTC to match Azure AppLens and backend diagnostics.
 */
function getUtcTimeString() {
  const now = new Date();
  const hours = now.getUTCHours().toString().padStart(2, '0');
  const minutes = now.getUTCMinutes().toString().padStart(2, '0');
  const seconds = now.getUTCSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

// Chart instances
let cpuMemoryChart = null;
let eventloopChart = null;
let latencyChart = null;

// Data history for CPU/Memory/EventLoop charts (60 data points at ~1s intervals = 60s)
const maxDataPoints = 60;
const chartData = {
  labels: [],
  cpu: [],
  memory: [],
  eventloop: [],
  rss: [],
};

// Separate data store for latency chart (60 seconds at 100ms intervals)
// We throttle probe updates to 10 per second to match this
const maxLatencyDataPoints = 600;
const latencyChartData = {
  labels: [],
  values: [],
};
let lastLatencyChartUpdate = 0;
const LATENCY_CHART_UPDATE_INTERVAL_MS = 100; // Update chart 10x per second

// Latency tracking - uses time-based retention (last 60 seconds)
// Each entry is { time: timestamp, value: latencyMs }
const LATENCY_STATS_WINDOW_MS = 60000; // 60 seconds
const latencyStats = {
  entries: [],    // Array of { time, value } for time-based stats
  current: 0,
  critical: 0,
};

/**
 * Adds a latency entry and prunes entries older than 60 seconds.
 * @param {number} latencyMs - The latency value in milliseconds
 */
function addLatencyEntry(latencyMs) {
  const now = Date.now();
  latencyStats.entries.push({ time: now, value: latencyMs });
  
  // Prune entries older than 60 seconds
  const cutoff = now - LATENCY_STATS_WINDOW_MS;
  latencyStats.entries = latencyStats.entries.filter(e => e.time >= cutoff);
}

/**
 * Gets all latency values from the last 60 seconds.
 * @returns {number[]} Array of latency values
 */
function getLatencyValuesLast60s() {
  const now = Date.now();
  const cutoff = now - LATENCY_STATS_WINDOW_MS;
  
  // Prune old entries and return values
  latencyStats.entries = latencyStats.entries.filter(e => e.time >= cutoff);
  return latencyStats.entries.map(e => e.value);
}

// Slow request latency tracking (separate from probe latency)
const slowRequestStats = {
  values: [],          // Last 20 slow request latencies
  maxValues: 20,
  lastLatency: null,
};

// Server responsiveness tracking
// Probe interval is dynamic: 100ms normally, 5000ms during slow request simulations
// to avoid noise in Node.js profiling tools (V8 CPU Profiler, Application Insights, perf traces).
const PROBE_INTERVAL_NORMAL_MS = 100;   // 100ms between probes (normal mode)
const PROBE_INTERVAL_REDUCED_MS = 5000; // 5 seconds during slow request testing
const PROBE_TIMEOUT_MS = 500;           // 500ms timeout per probe

let currentProbeIntervalMs = PROBE_INTERVAL_NORMAL_MS;
let probeMode = 'normal'; // 'normal' or 'reduced'

const serverResponsiveness = {
  isResponsive: true,
  lastProbeTime: Date.now(),
  lastSuccessfulProbe: Date.now(),
  probeInterval: null,
  consecutiveFailures: 0,
  unresponsiveStartTime: null,
  totalUnresponsiveTime: 0,
  probeHistory: [],      // Last 20 probe results for visualization
  maxProbeHistory: 20,
};

/**
 * Sets the probe mode. Use 'reduced' during slow request simulations to avoid
 * noise in Node.js profiling diagnostics (V8 Profiler, Application Insights).
 * @param {'normal'|'reduced'} mode - The probe mode
 */
function setProbeMode(mode) {
  if (mode === probeMode) return;
  
  probeMode = mode;
  currentProbeIntervalMs = mode === 'reduced' ? PROBE_INTERVAL_REDUCED_MS : PROBE_INTERVAL_NORMAL_MS;
  
  // Update UI message
  const messageEl = document.getElementById('probe-reduced-message');
  if (messageEl) {
    if (mode === 'reduced') {
      messageEl.style.display = 'block';
      messageEl.textContent = 'Latency probes reduced during Slow Request testing to ensure clean V8 Profile diagnostics.';
    } else {
      messageEl.style.display = 'none';
    }
  }
  
  // Restart probe with new interval
  startHeartbeatProbe();
  
  console.log(`[Probe] Mode changed to '${mode}' (interval: ${currentProbeIntervalMs}ms)`);
}

/**
 * Starts the server heartbeat probe system.
 * Detects when event loop is blocked by monitoring probe response times.
 */
function startHeartbeatProbe() {
  // Clear any existing interval
  if (serverResponsiveness.probeInterval) {
    clearInterval(serverResponsiveness.probeInterval);
  }
  
  serverResponsiveness.probeInterval = setInterval(async () => {
    const probeStart = Date.now();
    const timeout = probeMode === 'reduced' ? 2000 : PROBE_TIMEOUT_MS; // Longer timeout in reduced mode
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch('/api/health/probe', { 
        signal: controller.signal,
        cache: 'no-store'
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const probeEnd = Date.now();
        const latency = probeEnd - probeStart;
        
        // Record probe result
        recordProbeResult(latency, true);
        
        // Update latency stats with actual probe latency
        latencyStats.current = latency;
        addLatencyEntry(latency);
        if (latency > 30000) {
          latencyStats.critical++;
        }
        
        // Update latency chart data (throttled to 1 update per second for 60s display)
        const now = Date.now();
        if (now - lastLatencyChartUpdate >= LATENCY_CHART_UPDATE_INTERVAL_MS) {
          addLatencyToChart(latency);
          lastLatencyChartUpdate = now;
        }
        
        // Mark server as responsive
        if (!serverResponsiveness.isResponsive) {
          // Calculate how long it was unresponsive
          const unresponsiveDuration = Date.now() - serverResponsiveness.unresponsiveStartTime;
          serverResponsiveness.totalUnresponsiveTime += unresponsiveDuration;
          
          // Log recovery
          if (typeof addEventToLog === 'function') {
            addEventToLog({
              level: 'success',
              message: `Server responsive again after ${(unresponsiveDuration / 1000).toFixed(1)}s unresponsive`
            });
          }
        }
        
        serverResponsiveness.isResponsive = true;
        serverResponsiveness.lastSuccessfulProbe = Date.now();
        serverResponsiveness.consecutiveFailures = 0;
        serverResponsiveness.unresponsiveStartTime = null;
        
        updateResponsivenessUI();
        updateLatencyDisplay();
      }
    } catch (error) {
      // Probe failed or timed out
      recordProbeResult(timeout, false);
      serverResponsiveness.consecutiveFailures++;
      
      // After 2 consecutive failures, mark as unresponsive
      if (serverResponsiveness.consecutiveFailures >= 2 && serverResponsiveness.isResponsive) {
        serverResponsiveness.isResponsive = false;
        serverResponsiveness.unresponsiveStartTime = Date.now();
        
        if (typeof addEventToLog === 'function') {
          addEventToLog({
            level: 'warning',
            message: '⚠️ Server unresponsive - event loop may be blocked'
          });
        }
      }
      
      updateResponsivenessUI();
    }
    
    serverResponsiveness.lastProbeTime = Date.now();
  }, currentProbeIntervalMs);
}

/**
 * Records a probe result for visualization.
 */
function recordProbeResult(latency, success) {
  serverResponsiveness.probeHistory.push({
    time: Date.now(),
    latency,
    success
  });
  
  if (serverResponsiveness.probeHistory.length > serverResponsiveness.maxProbeHistory) {
    serverResponsiveness.probeHistory.shift();
  }
  
  updateProbeVisualization();
}

/**
 * Updates the probe visualization dots.
 */
function updateProbeVisualization() {
  const container = document.getElementById('probe-visualization');
  if (!container) return;
  
  container.innerHTML = serverResponsiveness.probeHistory.map(probe => {
    let className = 'probe-dot';
    if (!probe.success) {
      className += ' failed';
    } else if (probe.latency > 1000) {
      className += ' slow';
    } else if (probe.latency > 150) {
      className += ' degraded';
    }
    return `<div class="${className}" title="${probe.latency}ms"></div>`;
  }).join('');
}

/**
 * Adds a latency value to the latency chart.
 * The latency chart has its own data store for a 60-second window.
 * @param {number} latencyMs - The latency in milliseconds
 */
function addLatencyToChart(latencyMs) {
  const now = getUtcTimeString();
  
  latencyChartData.labels.push(now);
  latencyChartData.values.push(latencyMs);
  
  // Enforce 60-second window
  if (latencyChartData.labels.length > maxLatencyDataPoints) {
    latencyChartData.labels.shift();
    latencyChartData.values.shift();
  }
  
  // Update latency chart
  if (latencyChart) {
    latencyChart.update('none');
  }
}

/**
 * Records a slow request latency for visualization.
 * Called from dashboard.js when slow requests complete.
 * @param {number} latencyMs - The request latency in milliseconds
 */
function recordSlowRequestLatency(latencyMs) {
  // Add to slow request stats
  slowRequestStats.values.push(latencyMs);
  if (slowRequestStats.values.length > slowRequestStats.maxValues) {
    slowRequestStats.values.shift();
  }
  slowRequestStats.lastLatency = latencyMs;
  
  // Also add to main latency stats so MAX/AVG include slow requests
  addLatencyEntry(latencyMs);
  
  // Add to the latency chart (slow requests always show immediately)
  addLatencyToChart(latencyMs);
  
  // Track critical latencies (>30s)
  if (latencyMs > 30000) {
    latencyStats.critical++;
  }
  
  // Update the stats display
  updateLatencyDisplay();
}

/**
 * Updates the server responsiveness UI elements.
 */
function updateResponsivenessUI() {
  const statusEl = document.getElementById('server-responsive-status');
  const indicatorEl = document.getElementById('server-responsive-indicator');
  const durationEl = document.getElementById('unresponsive-duration');
  
  if (statusEl) {
    if (serverResponsiveness.isResponsive) {
      statusEl.textContent = 'Responsive';
      statusEl.className = 'responsive-status ok';
    } else {
      statusEl.textContent = 'UNRESPONSIVE';
      statusEl.className = 'responsive-status blocked';
    }
  }
  
  if (indicatorEl) {
    indicatorEl.className = serverResponsiveness.isResponsive 
      ? 'responsive-indicator ok' 
      : 'responsive-indicator blocked pulse';
  }
  
  if (durationEl) {
    if (!serverResponsiveness.isResponsive && serverResponsiveness.unresponsiveStartTime) {
      const duration = (Date.now() - serverResponsiveness.unresponsiveStartTime) / 1000;
      durationEl.textContent = `Blocked: ${duration.toFixed(1)}s`;
      durationEl.style.display = 'block';
    } else {
      durationEl.style.display = 'none';
    }
  }
}

// Update unresponsive duration display continuously when blocked
setInterval(() => {
  if (!serverResponsiveness.isResponsive) {
    updateResponsivenessUI();
  }
}, 100);

/**
 * Common chart configuration.
 */
const chartConfig = {
  animation: false,
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      enabled: true,
      mode: 'index',
      intersect: false,
      backgroundColor: 'rgba(50, 50, 50, 0.9)',
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: 'rgba(255, 255, 255, 0.2)',
      borderWidth: 1,
      cornerRadius: 4,
      padding: 10,
      displayColors: true,
      titleFont: {
        size: 12,
        weight: 'bold',
      },
      bodyFont: {
        size: 11,
      },
      callbacks: {
        title: function(tooltipItems) {
          return tooltipItems[0]?.label || '';
        },
      },
    },
  },
  scales: {
    x: {
      display: true,
      ticks: {
        maxTicksLimit: 6,
        font: { size: 10 },
      },
      grid: {
        color: 'rgba(0,0,0,0.05)',
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        maxTicksLimit: 5,
        font: { size: 10 },
      },
      grid: {
        color: 'rgba(0,0,0,0.05)',
      },
    },
  },
  elements: {
    point: {
      radius: 0,
      hoverRadius: 5,
      hoverBorderWidth: 2,
    },
    line: {
      tension: 0.3,
      borderWidth: 2,
    },
  },
};

/**
 * Initializes all charts.
 */
function initCharts() {
  // Combined CPU & Memory Chart
  const cpuMemoryCtx = document.getElementById('cpu-memory-chart')?.getContext('2d');
  if (cpuMemoryCtx) {
    cpuMemoryChart = new Chart(cpuMemoryCtx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'CPU %',
            data: chartData.cpu,
            borderColor: '#0078d4',
            backgroundColor: 'rgba(0, 120, 212, 0.2)',
            fill: true,
            yAxisID: 'y',
          },
          {
            label: 'Memory MB',
            data: chartData.memory,
            borderColor: '#107c10',
            backgroundColor: 'rgba(16, 124, 16, 0.2)',
            fill: true,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        ...chartConfig,
        scales: {
          ...chartConfig.scales,
          y: {
            ...chartConfig.scales.y,
            type: 'linear',
            position: 'left',
            max: 100,
            title: {
              display: false,
            },
          },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: {
              drawOnChartArea: false,
            },
            ticks: {
              maxTicksLimit: 5,
              font: { size: 10 },
            },
          },
        },
      },
    });
  }

  // Event Loop & RSS Memory Chart (combined)
  const eventloopCtx = document.getElementById('eventloop-chart')?.getContext('2d');
  if (eventloopCtx) {
    eventloopChart = new Chart(eventloopCtx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'Lag (ms)',
            data: chartData.eventloop,
            borderColor: '#8764b8',
            backgroundColor: 'rgba(135, 100, 184, 0.2)',
            fill: true,
            yAxisID: 'y',
          },
          {
            label: 'RSS (MB)',
            data: chartData.rss,
            borderColor: '#ffb900',
            backgroundColor: 'rgba(255, 185, 0, 0.2)',
            fill: true,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        ...chartConfig,
        scales: {
          ...chartConfig.scales,
          y: {
            ...chartConfig.scales.y,
            type: 'linear',
            position: 'left',
            title: {
              display: false,
            },
          },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: {
              drawOnChartArea: false,
            },
            ticks: {
              maxTicksLimit: 5,
              font: { size: 10 },
            },
          },
        },
      },
    });
  }

  // Latency Chart (uses separate data store for 60-second window)
  const latencyCtx = document.getElementById('latency-chart')?.getContext('2d');
  if (latencyCtx) {
    latencyChart = new Chart(latencyCtx, {
      type: 'line',
      data: {
        labels: latencyChartData.labels,
        datasets: [
          {
            label: 'Latency (ms)',
            data: latencyChartData.values,
            borderColor: '#107c10',
            backgroundColor: 'rgba(16, 124, 16, 0.2)',
            fill: true,
            // Show points for slow request latencies
            pointRadius: (context) => {
              const value = context.raw;
              return value > 1000 ? 4 : 0; // Show point if > 1 second
            },
            pointBackgroundColor: (context) => {
              const value = context.raw;
              if (value > 30000) return '#d13438'; // Critical: red
              if (value > 1000) return '#ffb900';  // Slow: orange
              return '#107c10';                     // Normal: green
            },
          },
        ],
      },
      options: {
        ...chartConfig,
        scales: {
          ...chartConfig.scales,
          y: {
            ...chartConfig.scales.y,
            // Dynamic max based on data - will auto-scale for slow requests
            beginAtZero: true,
            ticks: {
              maxTicksLimit: 5,
              font: { size: 10 },
              callback: function(value) {
                // Format large values as seconds
                if (value >= 1000) {
                  return (value / 1000).toFixed(0) + 's';
                }
                return value + 'ms';
              }
            },
          },
        },
        plugins: {
          ...chartConfig.plugins,
          tooltip: {
            ...chartConfig.plugins.tooltip,
            callbacks: {
              label: function(context) {
                const value = context.raw;
                if (value >= 1000) {
                  return `Latency: ${(value / 1000).toFixed(1)}s`;
                }
                return `Latency: ${value.toFixed(0)}ms`;
              }
            }
          }
        }
      },
    });
  }
}

/**
 * Updates charts with new metrics data.
 *
 * @param {Object} metrics - System metrics from server
 */
function updateCharts(metrics) {
  // Add new data point (UTC time to match Azure diagnostics)
  const now = getUtcTimeString();
  chartData.labels.push(now);
  chartData.cpu.push(metrics.cpu.usagePercent);
  chartData.memory.push(metrics.memory.heapUsedMb);
  // Use heartbeatLagMs for real-time event loop blocking visibility
  chartData.eventloop.push(metrics.eventLoop.heartbeatLagMs);
  chartData.rss.push(metrics.memory.rssMb);
  
  // Note: Latency is now tracked by the heartbeat probe system
  // Don't add fake latency data here
  
  // Update metric bar fills
  updateMetricBars(metrics);

  // Remove old data points if exceeding max
  if (chartData.labels.length > maxDataPoints) {
    chartData.labels.shift();
    chartData.cpu.shift();
    chartData.memory.shift();
    chartData.eventloop.shift();
    chartData.rss.shift();
  }

  // Update charts
  if (cpuMemoryChart) {
    cpuMemoryChart.update('none');
  }
  if (eventloopChart) {
    eventloopChart.update('none');
  }
  if (latencyChart) {
    latencyChart.update('none');
  }
}

/**
 * Updates the metric bar fills in the dashboard tiles.
 *
 * @param {Object} metrics - System metrics from server
 */
function updateMetricBars(metrics) {
  const cpuBar = document.getElementById('cpu-bar');
  const memoryBar = document.getElementById('memory-bar');
  const eventloopBar = document.getElementById('eventloop-bar');
  const rssBar = document.getElementById('rss-bar');
  
  if (cpuBar) {
    cpuBar.style.width = Math.min(100, metrics.cpu.usagePercent) + '%';
  }
  
  if (memoryBar) {
    // Use actual system memory for visualization
    const totalMb = metrics.memory.totalSystemMb || 4096;
    const memoryPercent = (metrics.memory.heapUsedMb / totalMb) * 100;
    memoryBar.style.width = Math.min(100, memoryPercent) + '%';
  }
  
  if (eventloopBar) {
    // Scale event loop lag: 0-100ms maps to 0-100%
    // Use heartbeatLagMs for real-time blocking visibility
    const lagPercent = Math.min(100, metrics.eventLoop.heartbeatLagMs);
    eventloopBar.style.width = lagPercent + '%';
  }
  
  if (rssBar) {
    // Use actual system memory for RSS visualization
    const totalMbForRss = metrics.memory.totalSystemMb || 4096;
    const rssPercent = (metrics.memory.rssMb / totalMbForRss) * 100;
    rssBar.style.width = Math.min(100, rssPercent) + '%';
  }
}

/**
 * Formats a latency value for display (ms or seconds).
 * @param {number} latencyMs - Latency in milliseconds
 * @returns {string} Formatted string with appropriate unit
 */
function formatLatency(latencyMs) {
  if (latencyMs >= 1000) {
    return (latencyMs / 1000).toFixed(1) + 's';
  }
  return latencyMs.toFixed(1) + 'ms';
}

/**
 * Gets the color for a latency value based on thresholds.
 * @param {number} latencyMs - Latency in milliseconds
 * @returns {string} CSS color value
 */
function getLatencyColor(latencyMs) {
  if (latencyMs >= 30000) return '#d13438';  // Critical (>30s): Red
  if (latencyMs >= 1000) return '#ff8c00';   // Severe (>1s): Orange
  if (latencyMs >= 150) return '#ffb900';    // Degraded (150ms-1s): Yellow
  return '#17a035';                           // Good (<150ms): Green
}

/**
 * Updates latency statistics display.
 */
function updateLatencyDisplay() {
  const currentEl = document.getElementById('latency-current');
  const avgEl = document.getElementById('latency-avg');
  const maxEl = document.getElementById('latency-max');
  const criticalEl = document.getElementById('latency-critical');
  
  // Get all values from the last 60 seconds
  const values = getLatencyValuesLast60s();
  
  if (currentEl) {
    currentEl.textContent = formatLatency(latencyStats.current);
    currentEl.style.color = getLatencyColor(latencyStats.current);
  }
  
  if (avgEl && values.length > 0) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    avgEl.textContent = formatLatency(avg);
    avgEl.style.color = getLatencyColor(avg);
  }
  
  if (maxEl && values.length > 0) {
    const max = Math.max(...values);
    maxEl.textContent = formatLatency(max);
    maxEl.style.color = getLatencyColor(max);
    // Add warning class if max is high
    if (max > 1000) {
      maxEl.classList.add('warning');
    } else {
      maxEl.classList.remove('warning');
    }
  }
  
  if (criticalEl) {
    criticalEl.textContent = latencyStats.critical.toString();
    // Green if 0, red if any critical events
    criticalEl.style.color = latencyStats.critical > 0 ? '#d13438' : '#17a035';
  }
}

/**
 * Clears all chart data.
 */
function clearCharts() {
  chartData.labels = [];
  chartData.cpu = [];
  chartData.memory = [];
  chartData.eventloop = [];
  chartData.rss = [];
  
  latencyChartData.labels = [];
  latencyChartData.values = [];
  
  latencyStats.entries = [];
  latencyStats.current = 0;
  latencyStats.critical = 0;

  if (cpuMemoryChart) cpuMemoryChart.update();
  if (eventloopChart) eventloopChart.update();
  if (latencyChart) latencyChart.update();
}

// Initialize charts when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  startHeartbeatProbe();
});
