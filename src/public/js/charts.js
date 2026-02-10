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

// Latency threshold colors for gradient fill
const LATENCY_COLORS = {
  good: { value: 0, color: 'rgba(16, 124, 16' },        // Green - good (<150ms)
  degraded: { value: 150, color: 'rgba(255, 185, 0' },  // Yellow - degraded (150ms-1s)
  severe: { value: 1000, color: 'rgba(255, 140, 0' },   // Orange - severe (1s+)
  critical: { value: 30000, color: 'rgba(209, 52, 56' } // Red - critical (30s+)
};

// RGB values for smooth color interpolation
const LATENCY_RGB = {
  good:     { r: 16,  g: 124, b: 16  }, // Green
  degraded: { r: 255, g: 185, b: 0   }, // Yellow
  severe:   { r: 255, g: 140, b: 0   }, // Orange
  critical: { r: 209, g: 52,  b: 56  }  // Red
};

/**
 * Interpolates between two RGB colors.
 * @param {Object} color1 - Start color {r, g, b}
 * @param {Object} color2 - End color {r, g, b}
 * @param {number} t - Interpolation factor (0-1)
 * @returns {string} - RGB color string
 */
function lerpColor(color1, color2, t) {
  t = Math.max(0, Math.min(1, t)); // Clamp to 0-1
  const r = Math.round(color1.r + (color2.r - color1.r) * t);
  const g = Math.round(color1.g + (color2.g - color1.g) * t);
  const b = Math.round(color1.b + (color2.b - color1.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Gets a smoothly interpolated color for a latency value.
 * Blends between threshold colors based on where the value falls.
 * @param {number} latencyMs - Latency value in milliseconds
 * @returns {string} - RGB color string
 */
function getInterpolatedLatencyColor(latencyMs) {
  if (latencyMs <= 0) return lerpColor(LATENCY_RGB.good, LATENCY_RGB.good, 0);
  
  // 0-150ms: green → yellow
  if (latencyMs <= 150) {
    const t = latencyMs / 150;
    return lerpColor(LATENCY_RGB.good, LATENCY_RGB.degraded, t);
  }
  
  // 150-1000ms: yellow → orange
  if (latencyMs <= 1000) {
    const t = (latencyMs - 150) / (1000 - 150);
    return lerpColor(LATENCY_RGB.degraded, LATENCY_RGB.severe, t);
  }
  
  // 1000-30000ms: orange → red
  if (latencyMs <= 30000) {
    const t = (latencyMs - 1000) / (30000 - 1000);
    return lerpColor(LATENCY_RGB.severe, LATENCY_RGB.critical, t);
  }
  
  // >30000ms: solid red
  return lerpColor(LATENCY_RGB.critical, LATENCY_RGB.critical, 1);
}

/**
 * Gets a smoothly interpolated RGBA color for a latency value (for gradient fills).
 * @param {number} latencyMs - Latency value in milliseconds
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} - RGBA color string
 */
function getInterpolatedLatencyColorRGBA(latencyMs, alpha) {
  let r, g, b;
  
  if (latencyMs <= 0) {
    r = LATENCY_RGB.good.r; g = LATENCY_RGB.good.g; b = LATENCY_RGB.good.b;
  } else if (latencyMs <= 150) {
    const t = latencyMs / 150;
    r = Math.round(LATENCY_RGB.good.r + (LATENCY_RGB.degraded.r - LATENCY_RGB.good.r) * t);
    g = Math.round(LATENCY_RGB.good.g + (LATENCY_RGB.degraded.g - LATENCY_RGB.good.g) * t);
    b = Math.round(LATENCY_RGB.good.b + (LATENCY_RGB.degraded.b - LATENCY_RGB.good.b) * t);
  } else if (latencyMs <= 1000) {
    const t = (latencyMs - 150) / (1000 - 150);
    r = Math.round(LATENCY_RGB.degraded.r + (LATENCY_RGB.severe.r - LATENCY_RGB.degraded.r) * t);
    g = Math.round(LATENCY_RGB.degraded.g + (LATENCY_RGB.severe.g - LATENCY_RGB.degraded.g) * t);
    b = Math.round(LATENCY_RGB.degraded.b + (LATENCY_RGB.severe.b - LATENCY_RGB.degraded.b) * t);
  } else if (latencyMs <= 30000) {
    const t = (latencyMs - 1000) / (30000 - 1000);
    r = Math.round(LATENCY_RGB.severe.r + (LATENCY_RGB.critical.r - LATENCY_RGB.severe.r) * t);
    g = Math.round(LATENCY_RGB.severe.g + (LATENCY_RGB.critical.g - LATENCY_RGB.severe.g) * t);
    b = Math.round(LATENCY_RGB.severe.b + (LATENCY_RGB.critical.b - LATENCY_RGB.severe.b) * t);
  } else {
    r = LATENCY_RGB.critical.r; g = LATENCY_RGB.critical.g; b = LATENCY_RGB.critical.b;
  }
  
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Creates a vertical gradient for the latency chart with smooth color blending.
 * Adds many intermediate color stops for seamless transitions between thresholds.
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} chartArea - Chart area dimensions
 * @param {Object} scales - Chart scales
 * @returns {CanvasGradient} - The gradient fill
 */
function createLatencyGradient(ctx, chartArea, scales) {
  if (!chartArea || !scales.y) return 'rgba(16, 124, 16, 0.2)';
  
  const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
  const yMax = scales.y.max || 200;
  
  // Add many color stops for smooth blending (20 stops from bottom to top)
  const numStops = 20;
  for (let i = 0; i <= numStops; i++) {
    const position = i / numStops; // 0 = bottom, 1 = top
    const latencyAtPosition = position * yMax;
    
    // Alpha increases slightly with latency for better visual distinction
    const alpha = 0.25 + (position * 0.25); // 0.25 at bottom to 0.50 at top
    
    const color = getInterpolatedLatencyColorRGBA(latencyAtPosition, alpha);
    gradient.addColorStop(position, color);
  }
  
  return gradient;
}

/**
 * Gets the border color for the latency line based on current max value.
 * Uses smooth interpolation between threshold colors.
 * @param {number} maxValue - Maximum latency value in the dataset
 * @returns {string} - CSS color string
 */
function getLatencyBorderColor(maxValue) {
  return getInterpolatedLatencyColor(maxValue);
}

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
  
  // Tell server to change probe interval via Socket.IO
  if (typeof socket !== 'undefined' && socket && socket.connected) {
    socket.emit('setProbeMode', mode);
    console.log(`[Probe] Mode changed to '${mode}' - server notified (interval: ${mode === 'reduced' ? '2500ms' : '250ms'})`);
  } else {
    console.log(`[Probe] Mode changed to '${mode}' but socket not connected`);
  }
}

/**
 * Handles incoming probe latency data from the server.
 * The server probes itself every 100ms and broadcasts the measured latency.
 * This replaces client-side fetch probing for consistency with AppLens traffic.
 * @param {Object} data - Probe data { latencyMs, timestamp }
 */
function onProbeLatency(data) {
  const latency = data.latencyMs;
  const probeTime = data.timestamp;
  
  // Record probe result
  recordProbeResult(latency, true);
  
  // Update latency stats with actual probe latency
  latencyStats.current = latency;
  addLatencyEntry(latency);
  if (latency > 30000) {
    latencyStats.critical++;
  }
  
  // Update latency chart data (throttled for display)
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
  serverResponsiveness.lastProbeTime = Date.now();
  
  updateResponsivenessUI();
  updateLatencyDisplay();
}

/**
 * Starts the server responsiveness monitoring.
 * Checks if we're receiving probe updates from the server.
 */
function startHeartbeatProbe() {
  // Clear any existing interval
  if (serverResponsiveness.probeInterval) {
    clearInterval(serverResponsiveness.probeInterval);
  }
  
  // Monitor for missing probe updates (server may be down/unresponsive)
  serverResponsiveness.probeInterval = setInterval(() => {
    const timeSinceLastProbe = Date.now() - serverResponsiveness.lastProbeTime;
    
    // If no probe received in 500ms, server may be unresponsive
    if (timeSinceLastProbe > 500) {
      serverResponsiveness.consecutiveFailures++;
      recordProbeResult(timeSinceLastProbe, false);
      
      // After 2 consecutive misses, mark as unresponsive
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
  }, 250); // Check 4x per second
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
 * Shows last 30 probe results as colored dots inline with the title.
 */
function updateProbeVisualization() {
  const container = document.getElementById('probe-visualization');
  if (!container) return;
  
  // Show last 30 probes
  const recentProbes = serverResponsiveness.probeHistory.slice(-30);
  
  container.innerHTML = recentProbes.map(probe => {
    let className = 'probe-dot-inline';
    if (!probe.success) {
      className += ' failed';
    } else if (probe.latency > 1000) {
      className += ' slow';
    } else if (probe.latency > 150) {
      className += ' degraded';
    }
    return `<span class="${className}"></span>`;
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
 * The probe dots visualization now shows responsiveness status.
 */
function updateResponsivenessUI() {
  // Probe visualization dots now show responsiveness status
  // No separate badge needed - red dots indicate failures
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
            // Segment-based border color - smooth gradient based on data value
            segment: {
              borderColor: (ctx) => {
                // Use the higher of the two endpoint values for smooth color blending
                const p0 = ctx.p0.parsed.y;
                const p1 = ctx.p1.parsed.y;
                const value = Math.max(p0, p1);
                return getInterpolatedLatencyColor(value);
              },
            },
            borderColor: '#107c10', // Default/fallback
            // Dynamic gradient fill based on latency thresholds
            backgroundColor: (context) => {
              const chart = context.chart;
              const { ctx, chartArea, scales } = chart;
              if (!chartArea) return 'rgba(16, 124, 16, 0.2)';
              return createLatencyGradient(ctx, chartArea, scales);
            },
            fill: true,
            // Show points for slow request latencies
            pointRadius: (context) => {
              const value = context.raw;
              return value > 1000 ? 4 : 0; // Show point if > 1 second
            },
            // Match hover radius to point radius to prevent orphaned hover dots
            pointHoverRadius: (context) => {
              const value = context.raw;
              return value > 1000 ? 6 : 0;
            },
            pointBackgroundColor: (context) => {
              const value = context.raw;
              return getInterpolatedLatencyColor(value);
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
