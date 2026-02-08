# Quickstart: Performance Problem Simulator

Get the Performance Problem Simulator running in under 5 minutes.

## Prerequisites

- **Node.js 20 LTS** or later ([download](https://nodejs.org/))
- **npm** (included with Node.js)
- A terminal/command prompt

## Installation

```bash
# Clone the repository (or download)
git clone <repository-url>
cd PerfSimNode

# Install dependencies
npm install

# Start the server
npm start
```

The server starts on `http://localhost:3000` by default.

## Verify It Works

### 1. Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-08T12:00:00.000Z",
  "uptime": 5.123,
  "version": "1.0.0"
}
```

### 2. Open the Dashboard

Open your browser to: **http://localhost:3000**

You should see the real-time metrics dashboard showing:
- CPU usage percentage
- Memory usage (heap and RSS)
- Event loop lag
- Active handles/requests

## Try Your First Simulation

### CPU Stress (30 seconds at 80% load)

**Via API:**
```bash
curl -X POST http://localhost:3000/api/simulations/cpu \
  -H "Content-Type: application/json" \
  -d '{"targetLoadPercent": 80, "durationSeconds": 30}'
```

**Via Dashboard:**
1. Find the "CPU Stress" section in the control panel
2. Set target load to 80%
3. Set duration to 30 seconds
4. Click "Start"

**Observe:**
- Watch the CPU metric spike in the dashboard
- Open `top` or Task Manager to see process CPU usage
- After 30 seconds, CPU returns to baseline

### Memory Pressure (Allocate 100MB)

```bash
# Allocate memory (save the returned ID)
curl -X POST http://localhost:3000/api/simulations/memory \
  -H "Content-Type: application/json" \
  -d '{"sizeMb": 100}'

# Response includes allocation ID, e.g.:
# {"id": "abc123...", "type": "MEMORY_PRESSURE", "message": "Memory allocated"}

# Release the memory when done
curl -X DELETE http://localhost:3000/api/simulations/memory/abc123...
```

### Event Loop Blocking (5 seconds)

```bash
# Warning: Server will be unresponsive during this
curl -X POST http://localhost:3000/api/simulations/eventloop \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds": 5}'
```

The response arrives after the blocking completes. Try making another request
during the block to observe the queuing behavior.

### Slow Request

```bash
# Request with 5-second delay
curl "http://localhost:3000/api/simulations/slow?delaySeconds=5"
```

## Configuration

Set environment variables before starting:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `METRICS_INTERVAL_MS` | 1000 | Metrics broadcast interval |
| `MAX_SIMULATION_DURATION_SECONDS` | 300 | Maximum simulation duration |
| `MAX_MEMORY_ALLOCATION_MB` | 500 | Maximum single memory allocation |

Example:
```bash
PORT=8080 npm start
```

## Deploy to Azure App Service

### Quick Deploy

1. Create an Azure App Service (Linux, Node.js 20 LTS)
2. Configure deployment from your repository (GitHub, Azure DevOps, etc.)
3. Ensure "Web sockets" is enabled in Configuration → General settings
4. Deploy

### Manual Deploy (ZIP)

```bash
# Create deployment package
npm run build  # if using TypeScript
zip -r deploy.zip . -x "node_modules/*" -x ".git/*"

# Deploy via Azure CLI
az webapp deploy --resource-group <rg> --name <app-name> --src-path deploy.zip
```

### Verify Azure Deployment

```bash
curl https://<your-app>.azurewebsites.net/api/health
```

## Next Steps

1. **Explore the Dashboard** - Try different simulations and observe metrics
2. **Read the Documentation** - Visit `/docs.html` for detailed guides
3. **Practice with Azure Diagnostics** - When deployed, use:
   - App Service Diagnostics (Azure Portal)
   - Application Insights (if configured)
   - Kudu SSH console (`https://<app>.scm.azurewebsites.net/webssh/host`)
   - Linux tools: `top`, `htop`, `node --inspect`

## Troubleshooting

### Port already in use
```bash
PORT=3001 npm start
```

### TypeScript compilation errors
```bash
npm run build  # Check for errors
```

### WebSocket not connecting
- Ensure no proxy is blocking WebSocket connections
- In Azure, verify "Web sockets" is enabled in Configuration

### Process crashes on crash simulation
This is expected! The crash simulation intentionally terminates the process.
In Azure App Service, the process restarts automatically.

## API Reference

Full API documentation: [contracts/openapi.yaml](contracts/openapi.yaml)

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
| `/api/simulations/slow` | GET | Slow response |
| `/api/simulations/crash/exception` | POST | Crash (exception) |
| `/api/simulations/crash/memory` | POST | Crash (OOM) |
| `/api/admin/status` | GET | Admin status |
| `/api/admin/events` | GET | Event log |
