# PerfSimNode

Performance Problem Simulator for Node.js - An educational tool for Azure support engineers to practice diagnosing common performance issues.

## Features

- **CPU Stress** - Generate controllable CPU load at specified percentages
- **Memory Pressure** - Allocate and retain memory to simulate leaks
- **Event Loop Blocking** - Block the Node.js event loop to demonstrate synchronous code impact
- **Slow Requests** - Simulate slow HTTP responses
- **Crash Simulation** - Trigger crashes for recovery testing
- **Real-time Dashboard** - Monitor metrics with live charts via WebSocket

## Quick Start

```bash
# Clone the repository
git clone <repository-url>
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

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
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

## Example Usage

### CPU Stress (30 seconds at 80% load)

```bash
curl -X POST http://localhost:3000/api/simulations/cpu \
  -H "Content-Type: application/json" \
  -d '{"targetLoadPercent": 80, "durationSeconds": 30}'
```

### Memory Pressure (Allocate 100MB)

```bash
# Allocate
curl -X POST http://localhost:3000/api/simulations/memory \
  -H "Content-Type: application/json" \
  -d '{"sizeMb": 100}'

# Release (use the returned ID)
curl -X DELETE http://localhost:3000/api/simulations/memory/{id}
```

### Event Loop Blocking (5 seconds)

```bash
curl -X POST http://localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 5}'
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `METRICS_INTERVAL_MS` | 1000 | Metrics broadcast interval |
| `MAX_SIMULATION_DURATION_SECONDS` | 300 | Maximum simulation duration |
| `MAX_MEMORY_ALLOCATION_MB` | 500 | Maximum memory allocation |

## Azure Deployment

The application is designed for Azure App Service Linux:

1. Create an App Service with Node.js 20 LTS
2. Enable WebSockets in Configuration → General settings
3. Deploy via Git, GitHub Actions, or ZIP deploy
4. Access the dashboard at your App Service URL

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
