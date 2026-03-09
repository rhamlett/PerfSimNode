# 🔥 PerfSimNode - Performance Problem Simulator

An educational tool designed to help Azure support engineers practice diagnosing common Node.js performance problems. It intentionally generates controllable performance issues that mimic real-world scenarios.

![Node.js](https://img.shields.io/badge/Node.js-24-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **CPU Stress** - Generate high CPU usage using child processes (`child_process.fork()`)
- **Memory Pressure** - Allocate and retain memory to simulate leaks with stacking behavior
- **Event Loop Blocking** - Block the Node.js event loop with synchronous operations
- **Slow Requests** - Multiple blocking patterns: setTimeout, libuv thread pool saturation, worker threads
- **Crash Simulation** - Trigger FailFast, stack overflow, unhandled exceptions, or OOM
- **Real-time Dashboard** - Monitor metrics with live charts via WebSocket (Socket.IO)

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

## Node.js Architecture Characteristics

Understanding these Node.js-specific behaviors is essential for diagnosing performance issues:

### Single-Threaded Event Loop

Node.js runs JavaScript on a **single thread**. All I/O operations are asynchronous, but CPU-intensive synchronous code blocks the entire event loop:

- **Blocked event loop** = No requests processed, WebSocket heartbeats fail, health checks timeout
- **High CPU in child processes** = May not affect latency (work is isolated)
- **Memory pressure** = Triggers garbage collection pauses, increasing event loop lag

### Process Model vs .NET Thread Pool

| Aspect | Node.js | .NET Core |
|--------|---------|-----------|
| Concurrency Model | Single thread + async I/O | Thread pool (many threads) |
| CPU-intensive work | Blocks all requests (unless in child process) | Affects individual threads |
| Scaling approach | Cluster mode / child processes | More threads |
| Memory per instance | Lower baseline (~30-50MB) | Higher baseline (~100-200MB) |

### JavaScript V8 Engine

- **JIT Compilation** - Code is optimized at runtime; initial requests may be slower
- **Garbage Collection** - Automatic but can cause pauses (visible as event loop lag spikes)
- **Heap Limit** - Default ~1.5GB on 64-bit; configurable via `--max-old-space-size`

## Simulations

### CPU Stress

**Implementation:** Uses `child_process.fork()` to spawn separate OS processes that run `crypto.pbkdf2Sync()` in a tight loop. This ensures actual CPU utilization without blocking the main event loop.

**Key characteristic:** Server stays responsive during CPU stress - work is isolated in child processes.

```bash
curl -X POST http://localhost:3000/api/simulations/cpu \
  -H "Content-Type: application/json" \
  -d '{"targetLoadPercent": 75, "durationSeconds": 30}'
```

| Parameter | Range | Description |
|-----------|-------|-------------|
| targetLoadPercent | 1-100 | Target CPU usage (spawns proportional workers) |
| durationSeconds | 1-300 | How long to run the simulation |

### Memory Pressure

**Implementation:** Allocates `Buffer` objects filled with random data, held until explicitly released. Multiple allocations stack.

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

**Implementation:** Performs synchronous `crypto.pbkdf2Sync()` directly in the main thread, blocking ALL async operations.

> ⚠️ **Warning:** Server becomes completely unresponsive. Dashboard freezes. WebSocket may disconnect.

**Key insight:** Unlike CPU stress (child processes), this blocks THE thread. Event Loop Lag equals block duration.

```bash
curl -X POST http://localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 5}'
```

**Symptoms to Observe:**
- Event loop lag spikes to blocking duration
- ALL requests queue and complete together after unblock
- Probe dots turn red in dashboard
- Dashboard metrics stop updating during block

### Slow Requests

**Implementation:** Three blocking patterns available:
- `setTimeout` - Non-blocking delay (server stays responsive)
- `libuv` - Saturates libuv thread pool (affects fs/dns operations)
- `worker` - Spawns blocking worker threads (similar to .NET ThreadPool)

**Key difference from Event Loop Blocking:** With non-blocking patterns, only the slow endpoint is affected. Health probes and other requests complete normally.

```bash
# Non-blocking (default)
curl "http://localhost:3000/api/simulations/slow?delaySeconds=10"

# libuv thread pool saturation
curl "http://localhost:3000/api/simulations/slow?delaySeconds=10&blockingPattern=libuv"

# Worker thread blocking
curl "http://localhost:3000/api/simulations/slow?delaySeconds=10&blockingPattern=worker"
```

### Crash Simulation

Intentionally crashes the Node.js process for testing crash recovery.

> ⚠️ **Warning:** These operations terminate the process. Azure App Service auto-restarts.

| Type | Endpoint | Effect |
|------|----------|--------|
| FailFast | `/crash/failfast` | Immediate SIGABRT, core dump |
| Stack Overflow | `/crash/stackoverflow` | Call stack exceeded |
| Exception | `/crash/exception` | Unhandled exception |
| OOM | `/crash/memory` | Memory exhaustion |

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
| `/api/metrics/probe` | GET | Lightweight probe for latency monitoring |
| `/api/metrics` | GET | Current system metrics |
| `/api/simulations` | GET | List active simulations |
| `/api/simulations/cpu` | POST | Start CPU stress (child processes) |
| `/api/simulations/cpu/:id` | DELETE | Stop CPU stress |
| `/api/simulations/memory` | POST | Allocate memory |
| `/api/simulations/memory/:id` | DELETE | Release memory |
| `/api/simulations/eventloop` | POST | Block event loop |
| `/api/simulations/slow` | GET | Slow request |
| `/api/simulations/crash/failfast` | POST | FailFast (SIGABRT) |
| `/api/simulations/crash/stackoverflow` | POST | Stack overflow |
| `/api/simulations/crash/exception` | POST | Unhandled exception |
| `/api/simulations/crash/memory` | POST | Memory exhaustion |
| `/api/admin/status` | GET | Admin status |
| `/api/admin/events` | GET | Event log |
| `/api/admin/system-info` | GET | System info (CPUs, memory, SKU) |

### WebSocket Events (Socket.IO)

Connect via Socket.IO to receive real-time updates:

| Event | Frequency | Description |
|-------|-----------|-------------|
| `metrics` | 1000ms | System metrics (CPU, memory, event loop) |
| `probeLatency` | 250ms / 2500ms | Request latency measurements |
| `event` | On occurrence | Simulation and system events |
| `simulation` | On status change | Simulation state updates |

*Probe frequency automatically increases to 2500ms during slow request testing for cleaner diagnostics.*

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `METRICS_INTERVAL_MS` | 1000 | Metrics broadcast interval |
| `MAX_SIMULATION_DURATION_SECONDS` | 300 | Maximum simulation duration |
| `MAX_MEMORY_ALLOCATION_MB` | 500 | Maximum memory allocation |
| `IDLE_TIMEOUT_MINUTES` | 20 | Idle timeout in minutes before suspending health probes |

## Azure Deployment

The application is designed for Azure App Service Linux with GitHub Actions OIDC deployment.

**Quick Start:**
1. Create an App Service with **Node.js 24 LTS** and **Linux**
2. Enable WebSockets in Configuration → General settings
3. Set up GitHub OIDC authentication (no secrets needed!)
4. Push to `main` branch to deploy

**📖 See [docs/azure-deployment.md](docs/azure-deployment.md) for the complete step-by-step guide** covering:
- App Service creation (Portal and CLI)
- Azure AD App Registration for GitHub OIDC
- Federated credentials configuration
- GitHub secrets setup
- Troubleshooting

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
