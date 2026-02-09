# 🔥 PerfSimNode - Performance Problem Simulator

An educational tool designed to help Azure support engineers practice diagnosing common Node.js performance problems. It intentionally generates controllable performance issues that mimic real-world scenarios.

![Node.js](https://img.shields.io/badge/Node.js-24-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **CPU Stress** - Generate high CPU usage at configurable percentages using cryptographic operations
- **Memory Pressure** - Allocate and retain memory to simulate leaks with stacking behavior
- **Event Loop Blocking** - Block the Node.js event loop with synchronous operations
- **Slow Requests** - Simulate slow HTTP responses with configurable delays
- **Crash Simulation** - Trigger unhandled exceptions or OOM conditions
- **Real-time Dashboard** - Monitor metrics with live charts via WebSocket

## Quick Start

```bash
# Clone the repository
git clone https://github.com/rhamlett/PerfSimNode.git
cd PerfSimNode

# Install dependencies
npm install

# Start in development mode
npm run dev

# Or build and run in production
npm run build
npm start
```

The server starts on `http://localhost:3000` by default.

## Architecture

The application runs as a single Node.js process with Express.js, Socket.IO for real-time metrics, and in-memory state (no persistence).

```
src/
├── index.ts                    # Entry point
├── app.ts                      # Express app setup
│
├── controllers/                # API endpoints
│   ├── admin.controller.ts
│   ├── cpu.controller.ts
│   ├── crash.controller.ts
│   ├── eventloop.controller.ts
│   ├── health.controller.ts
│   ├── memory.controller.ts
│   ├── metrics.controller.ts
│   └── slow.controller.ts
│
├── services/                   # Business logic
│   ├── cpu-stress.service.ts
│   ├── crash.service.ts
│   ├── event-log.service.ts
│   ├── eventloop-block.service.ts
│   ├── memory-pressure.service.ts
│   ├── metrics.service.ts
│   ├── simulation-tracker.service.ts
│   └── slow-request.service.ts
│
├── middleware/                 # Express middleware
│   ├── error-handler.ts
│   ├── request-logger.ts
│   └── validation.ts
│
├── types/                      # TypeScript interfaces
│   └── index.ts
│
├── utils/                      # Utility functions
│   └── index.ts
│
├── config/                     # Configuration
│   └── index.ts
│
└── public/                     # Static dashboard
    ├── index.html              # Main dashboard
    ├── docs.html               # Documentation page
    ├── azure-diagnostics.html  # Azure diagnostics guide
    ├── favicon.svg
    ├── css/
    │   └── styles.css
    └── js/
        ├── charts.js           # Chart.js integration
        ├── dashboard.js        # UI interactions
        └── socket-client.js    # Socket.IO client
```

## Simulations

### CPU Stress

Generates high CPU usage by performing cryptographic operations (PBKDF2) in a controlled loop.

```bash
curl -X POST http://localhost:3000/api/simulations/cpu \
  -H "Content-Type: application/json" \
  -d '{"targetLoadPercent": 80, "durationSeconds": 30}'
```

| Parameter | Range | Description |
|-----------|-------|-------------|
| targetLoadPercent | 1-100 | Target CPU usage percentage |
| durationSeconds | 1-300 | How long to run the simulation |

### Memory Pressure

Allocates and retains memory buffers to simulate memory leaks. Multiple allocations can coexist (stacking behavior).

```bash
# Allocate memory
curl -X POST http://localhost:3000/api/simulations/memory \
  -H "Content-Type: application/json" \
  -d '{"sizeMb": 100}'

# Release memory (use the returned ID)
curl -X DELETE http://localhost:3000/api/simulations/memory/{id}
```

| Parameter | Range | Description |
|-----------|-------|-------------|
| sizeMb | 1-500 | Memory to allocate in megabytes |

### Event Loop Blocking

Performs synchronous cryptographic operations that block the single-threaded event loop. All pending I/O, timers, and incoming requests are queued until the blocking completes.

> ⚠️ **Warning:** During this simulation, the server will be completely unresponsive to all requests. WebSocket connections may timeout.

```bash
curl -X POST http://localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 5}'
```

**Symptoms to Observe:**
- Event loop lag spikes in metrics
- Requests timeout or take unexpectedly long
- WebSocket heartbeats fail
- Health checks fail during blocking

### Slow Requests

Simulates slow HTTP responses using `setTimeout()`. Unlike event loop blocking, this doesn't affect other requests.

```bash
# Using query parameter (easy browser testing)
curl "http://localhost:3000/api/simulations/slow?delaySeconds=10"
```

### Crash Simulation

Intentionally crashes the Node.js process for testing crash recovery.

> ⚠️ **Warning:** These operations will terminate the process. In Azure App Service, the process will restart automatically.

```bash
# Unhandled exception
curl -X POST http://localhost:3000/api/simulations/crash/exception

# Memory exhaustion (OOM)
curl -X POST http://localhost:3000/api/simulations/crash/memory
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check with uptime |
| `/api/health/probe` | GET | Lightweight probe for latency monitoring |
| `/api/metrics` | GET | Current system metrics |
| `/api/simulations` | GET | List active simulations |
| `/api/simulations/cpu` | POST | Start CPU stress |
| `/api/simulations/cpu/:id` | DELETE | Stop CPU stress |
| `/api/simulations/memory` | POST | Allocate memory |
| `/api/simulations/memory/:id` | DELETE | Release memory |
| `/api/simulations/eventloop` | POST | Block event loop |
| `/api/simulations/slow` | GET | Slow request |
| `/api/simulations/crash/exception` | POST | Crash via exception |
| `/api/simulations/crash/memory` | POST | Crash via OOM |
| `/api/admin/status` | GET | Admin status |
| `/api/admin/events` | GET | Event log |

### WebSocket Events

Connect via Socket.IO to receive real-time updates:
- `metrics` - System metrics (every second)
- `event` - Simulation events
- `simulation` - Simulation status changes

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `METRICS_INTERVAL_MS` | 1000 | Metrics broadcast interval |
| `MAX_SIMULATION_DURATION_SECONDS` | 300 | Maximum simulation duration |
| `MAX_MEMORY_ALLOCATION_MB` | 500 | Maximum memory allocation |

## Azure Deployment

The application is designed for Azure App Service Linux:

1. Create an App Service with Node.js 20 LTS or later
2. Enable WebSockets in Configuration → General settings
3. Deploy via Git, GitHub Actions, or ZIP deploy
4. Access the dashboard at your App Service URL

### Diagnostics

The application includes a comprehensive **Azure Diagnostics Guide** accessible at `/azure-diagnostics.html` when running. It covers:

- Understanding metrics (CPU, memory, event loop lag, latency)
- Node.js vs .NET concurrency model differences
- Step-by-step diagnostic workflows for each simulation
- Azure App Service Diagnostics, Application Insights, and Kudu
- Linux diagnostic tools and commands
- Ready-to-use AppLens/KQL queries

## Development

```bash
# Run in development with hot reload
npm run dev

# Run tests
npm test

# Run linting
npm run lint

# Format code
npm run format
```

## License

MIT

---

Created by [SpecKit](https://speckit.org/) in collaboration with [Richard Hamlett](mailto:rhamlett@microsoft.com)
