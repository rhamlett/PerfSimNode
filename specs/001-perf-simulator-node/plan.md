# Implementation Plan: Performance Problem Simulator

**Branch**: `001-perf-simulator-node` | **Date**: 2026-02-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-perf-simulator-node/spec.md`

## Summary

Build an educational Node.js application that intentionally triggers controllable performance
problems (CPU stress, memory pressure, event loop blocking, slow requests, crashes) to help
Azure support engineers practice diagnostics. The application includes a REST API for triggering
simulations, a real-time WebSocket-powered dashboard for observing metrics, and built-in
documentation for Azure diagnostic tools.

## Technical Context

**Language/Version**: Node.js 20+ LTS with TypeScript (strict mode)  
**Primary Dependencies**: Express.js (HTTP server), Socket.IO (WebSocket), Chart.js (frontend charts)  
**Storage**: N/A (in-memory only, no persistence required per spec)  
**Testing**: Jest with ts-jest for unit and integration tests  
**Target Platform**: Azure App Service Linux (Node.js blessed image)  
**Project Type**: Single project with embedded static frontend (no build step for frontend)  
**Performance Goals**: Dashboard metrics update within 1 second; API responses within 2 seconds  
**Constraints**: Maximum 10 concurrent dashboard users; 300-second maximum simulation duration  
**Scale/Scope**: Single principal user (support engineer) in sandboxed test environment

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Requirement | Plan Compliance | Status |
|-----------|-------------|-----------------|--------|
| I. Code Quality & Readability | Descriptive names, single responsibility, no magic numbers | All services will have clear names (CpuStressService, MetricsCollector); constants in config module | ✅ Pass |
| II. Documentation-First | JSDoc for all exports, README files | Every service/controller gets JSDoc; README at root and /docs for guides | ✅ Pass |
| III. TDD (Encouraged) | Tests before implementation when practical | Unit tests for services; integration tests for API endpoints | ✅ Pass |
| IV. Simplicity | YAGNI, minimal abstractions | No ORM (no DB), no complex DI framework, vanilla JS frontend | ✅ Pass |

**Technology Standards Compliance**:
- TypeScript strict mode: ✅ Will enable in tsconfig.json
- ESLint + Prettier: ✅ Will configure
- Jest for testing: ✅ Selected

**Gate Result**: ✅ PASS - No violations requiring justification

## Project Structure

### Documentation (this feature)

```text
specs/001-perf-simulator-node/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (OpenAPI spec)
│   └── openapi.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── index.ts                    # Application entry point
├── app.ts                      # Express app configuration
├── config/
│   └── index.ts                # Environment and default configuration
├── controllers/
│   ├── health.controller.ts    # Health check endpoint
│   ├── metrics.controller.ts   # System metrics endpoint
│   ├── cpu.controller.ts       # CPU stress simulation endpoints
│   ├── memory.controller.ts    # Memory pressure endpoints
│   ├── eventloop.controller.ts # Event loop blocking endpoints
│   ├── slow.controller.ts      # Slow request simulation
│   ├── crash.controller.ts     # Crash simulation endpoints
│   └── admin.controller.ts     # Admin/status endpoints
├── services/
│   ├── metrics.service.ts      # System metrics collection (CPU, memory, event loop lag)
│   ├── cpu-stress.service.ts   # CPU stress simulation logic
│   ├── memory-pressure.service.ts  # Memory allocation/release logic
│   ├── eventloop-block.service.ts  # Event loop blocking logic
│   ├── slow-request.service.ts     # Configurable delay logic
│   ├── crash.service.ts        # Crash trigger logic
│   ├── simulation-tracker.service.ts # Track active simulations
│   └── event-log.service.ts    # Simulation event logging
├── middleware/
│   ├── error-handler.ts        # Global error handling
│   ├── request-logger.ts       # Request logging middleware
│   └── validation.ts           # Input validation helpers
├── types/
│   └── index.ts                # TypeScript interfaces and types
├── utils/
│   └── index.ts                # Shared utility functions
└── public/
    ├── index.html              # Dashboard HTML
    ├── docs.html               # Documentation page
    ├── css/
    │   └── styles.css          # Dashboard styles
    └── js/
        ├── dashboard.js        # Dashboard logic (vanilla JS)
        ├── charts.js           # Chart.js integration
        └── socket-client.js    # Socket.IO client

tests/
├── unit/
│   ├── services/
│   │   ├── metrics.service.test.ts
│   │   ├── cpu-stress.service.test.ts
│   │   ├── memory-pressure.service.test.ts
│   │   ├── eventloop-block.service.test.ts
│   │   └── simulation-tracker.service.test.ts
│   └── controllers/
│       └── health.controller.test.ts
└── integration/
    ├── api.test.ts             # Full API endpoint tests
    └── websocket.test.ts       # WebSocket connection tests

docs/
├── README.md                   # Project overview and quickstart
├── azure-diagnostics.md        # Azure diagnostic tools guide
├── linux-tools.md              # Linux CLI diagnostic tools
└── simulations/
    ├── cpu-stress.md
    ├── memory-pressure.md
    ├── eventloop-blocking.md
    ├── slow-requests.md
    └── crash-simulation.md
```

**Structure Decision**: Single project structure selected because the application is a monolithic
Node.js server with an embedded static frontend. No separate frontend build process is required
(vanilla JavaScript), aligning with the Constitution's Simplicity principle.

## Complexity Tracking

> No violations identified. Constitution gates passed without justification needed.

## Constitution Check (Post-Design Re-evaluation)

*Re-evaluated after Phase 1 design completion.*

| Principle | Design Compliance | Status |
|-----------|-------------------|--------|
| I. Code Quality & Readability | Services have single responsibilities (cpu-stress.service, memory-pressure.service, etc.); Types defined in types/index.ts; Constants centralized in config/ | ✅ Pass |
| II. Documentation-First | OpenAPI spec defines all endpoints; data-model.md provides TypeScript interfaces with JSDoc comments; quickstart.md provides onboarding guide | ✅ Pass |
| III. TDD (Encouraged) | Test structure defined (tests/unit/, tests/integration/); Tests planned for all services and API endpoints | ✅ Pass |
| IV. Simplicity | No ORM (in-memory only); vanilla JS frontend (no build step); single project structure; minimal dependencies (Express, Socket.IO, Chart.js) | ✅ Pass |

**Post-Design Gate Result**: ✅ PASS - Design adheres to all constitution principles.

## Implementation Phases

### Phase 1: Foundation
- Express server setup with TypeScript
- Health endpoint (`GET /api/health`)
- Configuration module (environment variables)
- Metrics collection service (process.memoryUsage, process.cpuUsage, perf_hooks for event loop lag)
- Basic project tooling (ESLint, Prettier, Jest)

### Phase 2: Core Simulations
- CPU stress service (crypto.pbkdf2Sync for computation, optional worker threads)
- Memory pressure service (Buffer allocation with tracking)
- Event loop blocking service (synchronous operations)
- Slow request service (setTimeout-based delays)
- Simulation tracker service (manage active simulations)

### Phase 3: Real-Time Dashboard
- Socket.IO integration for metrics broadcasting
- Static HTML dashboard with vanilla JavaScript
- Chart.js for CPU/memory trend visualization
- Simulation control panel with parameter inputs
- Event log display

### Phase 4: Additional Features
- Crash simulation service (unhandled exception, memory exhaustion)
- Admin endpoints for status and configuration
- Request logging middleware

### Phase 5: Documentation & Polish
- In-app documentation page (static HTML)
- Azure Diagnostics guide (App Service Diagnostics, Application Insights, Kudu SSH)
- Linux tools guide (top, htop, node --inspect)
- README with quickstart instructions
- Input validation and error handling refinement
