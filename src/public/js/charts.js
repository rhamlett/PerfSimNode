/**
 * Chart.js Integration
 *
 * Manages real-time metric charts using Chart.js.
 */

// Chart instances
let cpuChart = null;
let memoryChart = null;
let eventloopChart = null;

// Data history (last 60 points = 60 seconds at 1s interval)
const maxDataPoints = 60;
const chartData = {
  labels: [],
  cpu: [],
  memory: [],
  eventloop: [],
};

/**
 * Common chart configuration.
 */
const chartConfig = {
  animation: false,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
  },
  scales: {
    x: {
      display: false,
    },
    y: {
      beginAtZero: true,
      ticks: {
        maxTicksLimit: 4,
      },
    },
  },
  elements: {
    point: {
      radius: 0,
    },
    line: {
      tension: 0.2,
    },
  },
};

/**
 * Initializes all charts.
 */
function initCharts() {
  // CPU Chart
  const cpuCtx = document.getElementById('cpu-chart')?.getContext('2d');
  if (cpuCtx) {
    cpuChart = new Chart(cpuCtx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            data: chartData.cpu,
            borderColor: '#0078d4',
            backgroundColor: 'rgba(0, 120, 212, 0.1)',
            fill: true,
          },
        ],
      },
      options: {
        ...chartConfig,
        scales: {
          ...chartConfig.scales,
          y: {
            ...chartConfig.scales.y,
            max: 100,
          },
        },
      },
    });
  }

  // Memory Chart
  const memoryCtx = document.getElementById('memory-chart')?.getContext('2d');
  if (memoryCtx) {
    memoryChart = new Chart(memoryCtx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            data: chartData.memory,
            borderColor: '#107c10',
            backgroundColor: 'rgba(16, 124, 16, 0.1)',
            fill: true,
          },
        ],
      },
      options: chartConfig,
    });
  }

  // Event Loop Chart
  const eventloopCtx = document.getElementById('eventloop-chart')?.getContext('2d');
  if (eventloopCtx) {
    eventloopChart = new Chart(eventloopCtx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            data: chartData.eventloop,
            borderColor: '#ff8c00',
            backgroundColor: 'rgba(255, 140, 0, 0.1)',
            fill: true,
          },
        ],
      },
      options: chartConfig,
    });
  }
}

/**
 * Updates charts with new metrics data.
 *
 * @param {Object} metrics - System metrics from server
 */
function updateCharts(metrics) {
  // Add new data point
  const now = new Date().toLocaleTimeString();
  chartData.labels.push(now);
  chartData.cpu.push(metrics.cpu.usagePercent);
  chartData.memory.push(metrics.memory.heapUsedMb);
  chartData.eventloop.push(metrics.eventLoop.lagMs);

  // Remove old data points if exceeding max
  if (chartData.labels.length > maxDataPoints) {
    chartData.labels.shift();
    chartData.cpu.shift();
    chartData.memory.shift();
    chartData.eventloop.shift();
  }

  // Update charts
  if (cpuChart) {
    cpuChart.update('none');
  }
  if (memoryChart) {
    memoryChart.update('none');
  }
  if (eventloopChart) {
    eventloopChart.update('none');
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

  if (cpuChart) cpuChart.update();
  if (memoryChart) memoryChart.update();
  if (eventloopChart) eventloopChart.update();
}

// Initialize charts when DOM is ready
document.addEventListener('DOMContentLoaded', initCharts);
