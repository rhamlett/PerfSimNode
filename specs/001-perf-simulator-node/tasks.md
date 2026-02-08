# Tasks: Performance Problem Simulator (Node.js)

**Input**: Design documents from `/specs/001-perf-simulator-node/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/openapi.yaml ✓

**Tests**: TDD is encouraged per constitution. Test tasks are included but marked optional.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5, US6)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths assume single project structure per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, TypeScript configuration, and tooling

- [X] T001 Initialize npm project with package.json in repository root
- [X] T002 Configure TypeScript with strict mode in tsconfig.json
- [X] T003 [P] Configure ESLint for TypeScript in .eslintrc.js
- [X] T004 [P] Configure Prettier in .prettierrc
- [X] T005 [P] Configure Jest with ts-jest in jest.config.js
- [X] T006 Create application entry point in src/index.ts
- [X] T007 Create Express app configuration in src/app.ts
- [X] T008 [P] Create TypeScript types and interfaces in src/types/index.ts
- [X] T009 [P] Create configuration module in src/config/index.ts
- [X] T010 [P] Create utility functions in src/utils/index.ts
- [X] T011 [P] Create global error handler middleware in src/middleware/error-handler.ts
- [X] T012 Add npm scripts (dev, build, start, test, lint) to package.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T013 Implement MetricsService for system metrics collection in src/services/metrics.service.ts
- [X] T014 Implement SimulationTrackerService for managing active simulations in src/services/simulation-tracker.service.ts
- [X] T015 Implement EventLogService for logging simulation events in src/services/event-log.service.ts
- [X] T016 [P] Create request logger middleware in src/middleware/request-logger.ts
- [X] T017 [P] Create input validation helpers in src/middleware/validation.ts
- [X] T018 Implement HealthController with GET /api/health in src/controllers/health.controller.ts
- [X] T019 Implement MetricsController with GET /api/metrics in src/controllers/metrics.controller.ts
- [X] T020 Register health and metrics routes in src/app.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - CPU Stress Training (Priority: P1) 🎯 MVP

**Goal**: Trigger controlled CPU stress and observe via diagnostic tools

**Independent Test**: Start simulator, trigger CPU stress via API, verify CPU spike in top/htop

### Tests for User Story 1 (OPTIONAL - TDD encouraged) ⚠️

- [X] T021 [P] [US1] Unit test for CpuStressService in tests/unit/services/cpu-stress.service.test.ts
- [X] T022 [P] [US1] Unit test for SimulationTrackerService in tests/unit/services/simulation-tracker.service.test.ts
- [X] T023 [P] [US1] Integration test for CPU endpoints in tests/integration/cpu-api.test.ts

### Implementation for User Story 1

- [X] T024 [US1] Implement CpuStressService with CPU burn logic in src/services/cpu-stress.service.ts
- [X] T025 [US1] Implement CpuController with POST /api/simulations/cpu in src/controllers/cpu.controller.ts
- [X] T026 [US1] Add DELETE /api/simulations/cpu/:id to CpuController in src/controllers/cpu.controller.ts
- [X] T027 Implement GET /api/simulations for listing active simulations in src/controllers/admin.controller.ts
- [X] T028 [US1] Register CPU simulation routes in src/app.ts
- [X] T029 [US1] Add input validation for CPU stress parameters (1-100%, 1-300s)
- [X] T030 [US1] Wire MetricsService CPU collection using process.cpuUsage in src/services/metrics.service.ts

**Checkpoint**: CPU stress simulation fully functional via API

---

## Phase 4: User Story 2 - Real-Time Metrics Dashboard (Priority: P2)

**Goal**: Visual dashboard with live metrics and simulation controls

**Independent Test**: Open dashboard in browser, trigger CPU simulation, observe real-time chart updates

### Tests for User Story 2 (OPTIONAL - TDD encouraged) ⚠️

- [ ] T031 [P] [US2] Integration test for WebSocket connection in tests/integration/websocket.test.ts

### Implementation for User Story 2

- [X] T032 [US2] Install and configure Socket.IO in src/app.ts
- [X] T033 [US2] Implement metrics broadcasting via Socket.IO (1-second interval) in src/app.ts
- [X] T034 [US2] Create dashboard HTML structure in src/public/index.html
- [X] T035 [P] [US2] Create dashboard CSS styles in src/public/css/styles.css
- [X] T036 [US2] Implement Socket.IO client connection in src/public/js/socket-client.js
- [X] T037 [US2] Implement dashboard metrics display logic in src/public/js/dashboard.js
- [X] T038 [US2] Implement Chart.js CPU/memory trend charts in src/public/js/charts.js
- [X] T039 [US2] Add simulation control panel with forms in src/public/index.html
- [X] T040 [US2] Add event log display section in src/public/index.html
- [X] T041 [US2] Wire control panel buttons to API calls in src/public/js/dashboard.js
- [X] T042 [US2] Add WebSocket reconnection logic with status indicator in src/public/js/socket-client.js
- [X] T043 [US2] Configure Express to serve static files from src/public

**Checkpoint**: Dashboard shows live metrics and can trigger/stop CPU simulations

---

## Phase 5: User Story 3 - Memory Pressure Simulation (Priority: P3)

**Goal**: Allocate and release memory to simulate memory pressure

**Independent Test**: Trigger memory allocation via API, observe heap growth in metrics, release and verify decrease

### Tests for User Story 3 (OPTIONAL - TDD encouraged) ⚠️

- [X] T044 [P] [US3] Unit test for MemoryPressureService in tests/unit/services/memory-pressure.service.test.ts
- [X] T045 [P] [US3] Integration test for memory endpoints in tests/integration/memory-api.test.ts

### Implementation for User Story 3

- [X] T046 [US3] Implement MemoryPressureService with Buffer.alloc in src/services/memory-pressure.service.ts
- [X] T047 [US3] Add allocation tracking Map to MemoryPressureService for explicit release
- [X] T048 [US3] Implement MemoryController with POST /api/simulations/memory in src/controllers/memory.controller.ts
- [X] T049 [US3] Add DELETE /api/simulations/memory/:id for releasing allocations in src/controllers/memory.controller.ts
- [X] T050 [US3] Add input validation for memory size (1-500 MB per config)
- [X] T051 [US3] Add pre-allocation check to prevent exceeding available memory
- [X] T052 [US3] Register memory simulation routes in src/app.ts
- [X] T053 [US3] Add memory controls to dashboard in src/public/index.html
- [X] T054 [US3] Wire memory control buttons in src/public/js/dashboard.js

**Checkpoint**: Memory pressure simulation fully functional via API and dashboard

---

## Phase 6: User Story 4 - Event Loop Blocking Simulation (Priority: P4)

**Goal**: Block event loop to demonstrate Node.js-specific performance issue

**Independent Test**: Trigger blocking, observe event loop lag spike, verify concurrent requests queue

### Tests for User Story 4 (OPTIONAL - TDD encouraged) ⚠️

- [X] T055 [P] [US4] Unit test for EventLoopBlockService in tests/unit/services/eventloop-block.service.test.ts
- [ ] T056 [P] [US4] Integration test for event loop blocking in tests/integration/eventloop-api.test.ts

### Implementation for User Story 4

- [X] T057 [US4] Implement EventLoopBlockService with sync crypto in src/services/eventloop-block.service.ts
- [X] T058 [US4] Implement EventLoopController with POST /api/simulations/eventloop in src/controllers/eventloop.controller.ts
- [X] T059 [US4] Add input validation for blocking duration (1-300s)
- [X] T060 [US4] Register event loop blocking routes in src/app.ts
- [X] T061 [US4] Wire event loop lag metrics using perf_hooks.monitorEventLoopDelay in src/services/metrics.service.ts
- [X] T062 [US4] Add event loop blocking controls to dashboard in src/public/index.html
- [X] T063 [US4] Wire event loop control buttons in src/public/js/dashboard.js

**Checkpoint**: Event loop blocking simulation functional with lag metrics visible

---

## Phase 7: User Story 5 - Slow Requests & Crash Simulation (Priority: P5)

**Goal**: Simulate slow HTTP responses and application crashes

**Independent Test**: Request slow endpoint, verify delayed response; trigger crash, observe process termination

### Tests for User Story 5 (OPTIONAL - TDD encouraged) ⚠️

- [ ] T064 [P] [US5] Unit test for SlowRequestService in tests/unit/services/slow-request.service.test.ts
- [ ] T065 [P] [US5] Integration test for slow request endpoint in tests/integration/slow-api.test.ts

### Implementation for User Story 5

- [X] T066 [US5] Implement SlowRequestService with setTimeout delay in src/services/slow-request.service.ts
- [X] T067 [US5] Implement SlowController with GET /api/simulations/slow in src/controllers/slow.controller.ts
- [X] T068 [US5] Add input validation for delay duration (1-300s)
- [X] T069 [US5] Implement CrashService with exception and OOM methods in src/services/crash.service.ts
- [X] T070 [US5] Implement CrashController with POST /api/simulations/crash/exception in src/controllers/crash.controller.ts
- [X] T071 [US5] Add POST /api/simulations/crash/memory to CrashController in src/controllers/crash.controller.ts
- [X] T072 [US5] Register slow request and crash routes in src/app.ts
- [X] T073 [US5] Add slow request and crash controls to dashboard in src/public/index.html
- [X] T074 [US5] Wire slow request and crash buttons in src/public/js/dashboard.js

**Checkpoint**: Slow requests and crash simulations functional

---

## Phase 8: User Story 6 - Documentation & Azure Diagnostic Guides (Priority: P6)

**Goal**: Built-in documentation explaining simulations and Azure diagnostic approaches

**Independent Test**: Access /docs.html, verify all simulation types documented with Azure guidance

### Implementation for User Story 6

- [X] T075 [P] [US6] Create documentation page HTML structure in src/public/docs.html
- [X] T076 [P] [US6] Create project README with quickstart in docs/README.md
- [X] T077 [P] [US6] Create Azure diagnostics guide in docs/azure-diagnostics.md
- [X] T078 [P] [US6] Create Linux tools guide in docs/linux-tools.md
- [X] T079 [P] [US6] Create CPU stress simulation guide in docs/simulations/cpu-stress.md
- [X] T080 [P] [US6] Create memory pressure simulation guide in docs/simulations/memory-pressure.md
- [X] T081 [P] [US6] Create event loop blocking guide in docs/simulations/eventloop-blocking.md
- [X] T082 [P] [US6] Create slow requests guide in docs/simulations/slow-requests.md
- [X] T083 [P] [US6] Create crash simulation guide in docs/simulations/crash-simulation.md
- [X] T084 [US6] Add documentation link to dashboard navigation in src/public/index.html
- [X] T085 [US6] Style documentation page in src/public/css/styles.css

**Checkpoint**: All documentation accessible via the application

---

## Phase 9: Admin & Polish

**Purpose**: Admin endpoints, final integration, and cross-cutting improvements

- [X] T086 Implement AdminController with GET /api/admin/status in src/controllers/admin.controller.ts
- [X] T087 Add GET /api/admin/events for event log retrieval in src/controllers/admin.controller.ts
- [X] T088 Register admin routes in src/app.ts
- [ ] T089 [P] Add Application Insights optional integration in src/config/index.ts
- [X] T090 Final input validation review across all controllers
- [X] T091 Final error handling review for edge cases
- [ ] T092 Run quickstart.md validation to verify end-to-end flow
- [X] T093 Update package.json version and finalize dependencies

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4 → P5 → P6)
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational - Benefits from US1 for demo purposes
- **User Story 3 (P3)**: Can start after Foundational - Independent of US1/US2
- **User Story 4 (P4)**: Can start after Foundational - Independent of other stories
- **User Story 5 (P5)**: Can start after Foundational - Independent of other stories
- **User Story 6 (P6)**: Can start after Foundational - No code dependencies, just documentation

### Within Each User Story

- Tests SHOULD be written before implementation (TDD encouraged)
- Services before controllers
- Controllers before route registration
- Backend complete before dashboard integration

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel
- All tests for a user story marked [P] can run in parallel
- All documentation tasks in US6 marked [P] can run in parallel

---

## Parallel Example: Setup Phase

```bash
# Launch all parallel setup tasks together:
Task T003: "Configure ESLint for TypeScript in .eslintrc.js"
Task T004: "Configure Prettier in .prettierrc"
Task T005: "Configure Jest with ts-jest in jest.config.js"
Task T008: "Create TypeScript types and interfaces in src/types/index.ts"
Task T009: "Create configuration module in src/config/index.ts"
Task T010: "Create utility functions in src/utils/index.ts"
Task T011: "Create global error handler middleware in src/middleware/error-handler.ts"
```

## Parallel Example: User Story 6 (Documentation)

```bash
# All documentation files can be written in parallel:
Task T075: "Create documentation page HTML structure in src/public/docs.html"
Task T076: "Create project README with quickstart in docs/README.md"
Task T077: "Create Azure diagnostics guide in docs/azure-diagnostics.md"
Task T078: "Create Linux tools guide in docs/linux-tools.md"
Task T079-T083: All simulation guides in docs/simulations/
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 - CPU Stress
4. **STOP and VALIDATE**: Test CPU stress independently
5. Deploy/demo if ready for initial feedback

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 (CPU) → Test independently → Deploy (MVP!)
3. Add User Story 2 (Dashboard) → Test independently → Deploy
4. Add User Story 3 (Memory) → Test independently → Deploy
5. Add User Story 4 (Event Loop) → Test independently → Deploy
6. Add User Story 5 (Slow/Crash) → Test independently → Deploy
7. Add User Story 6 (Docs) → Test independently → Deploy
8. Add Phase 9 (Polish) → Final release

### File-to-Task Quick Reference

| File Path | Tasks |
|-----------|-------|
| src/services/metrics.service.ts | T013, T030, T061 |
| src/services/cpu-stress.service.ts | T024 |
| src/services/memory-pressure.service.ts | T046, T047 |
| src/services/eventloop-block.service.ts | T057 |
| src/services/slow-request.service.ts | T066 |
| src/services/crash.service.ts | T069 |
| src/services/simulation-tracker.service.ts | T014 |
| src/services/event-log.service.ts | T015 |
| src/controllers/health.controller.ts | T018 |
| src/controllers/metrics.controller.ts | T019 |
| src/controllers/cpu.controller.ts | T025, T026 |
| src/controllers/memory.controller.ts | T048, T049 |
| src/controllers/eventloop.controller.ts | T058 |
| src/controllers/slow.controller.ts | T067 |
| src/controllers/crash.controller.ts | T070, T071 |
| src/controllers/admin.controller.ts | T027, T086, T087 |
| src/public/index.html | T034, T039, T040, T053, T062, T073, T084 |
| src/public/js/dashboard.js | T037, T041, T054, T063, T074 |
| src/public/js/charts.js | T038 |
| src/public/js/socket-client.js | T036, T042 |
| src/public/css/styles.css | T035, T085 |
| src/public/docs.html | T075 |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Tests are encouraged but not mandatory per constitution
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence

---

## Summary

| Metric | Count |
|--------|-------|
| Total Tasks | 93 |
| Setup Tasks | 12 |
| Foundational Tasks | 8 |
| US1 Tasks (CPU Stress) | 10 |
| US2 Tasks (Dashboard) | 13 |
| US3 Tasks (Memory) | 11 |
| US4 Tasks (Event Loop) | 9 |
| US5 Tasks (Slow/Crash) | 11 |
| US6 Tasks (Documentation) | 11 |
| Polish Tasks | 8 |
| Parallel Opportunities | 35 tasks marked [P] |
