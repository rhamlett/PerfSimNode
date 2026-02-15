/**
 * =============================================================================
 * MEMORY CONTROLLER — Memory Pressure Simulation REST API
 * =============================================================================
 *
 * PURPOSE:
 *   REST endpoints for allocating, releasing, and listing memory allocations.
 *   Memory allocations persist until explicitly released (no auto-expiry).
 *
 * ENDPOINTS:
 *   POST   /api/simulations/memory     → Allocate memory (body: sizeMb)
 *   DELETE /api/simulations/memory/:id → Release a memory allocation (idempotent)
 *   GET    /api/simulations/memory     → List active allocations with total
 *
 * DESIGN DECISION:
 *   DELETE is idempotent — releasing an already-released allocation returns
 *   success (not 404). This prevents issues with double-clicks and retries.
 *
 * @module controllers/memory
 */

import { Router, Request, Response, NextFunction } from 'express';
import { MemoryPressureService } from '../services/memory-pressure.service';
import { validateMemoryPressureParams, validateUuid } from '../middleware/validation';

/**
 * Express router for memory simulation endpoints.
 */
export const memoryRouter = Router();

/**
 * POST /api/simulations/memory
 *
 * Allocates memory to simulate memory pressure.
 *
 * @route POST /api/simulations/memory
 * @body {number} sizeMb - Memory to allocate in megabytes (no limit)
 * @returns {SimulationResponse} Created allocation details
 */
memoryRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input parameters
    const { sizeMb } = validateMemoryPressureParams(req.body.sizeMb);

    // Allocate memory
    const simulation = MemoryPressureService.allocate({ sizeMb });

    res.status(201).json({
      id: simulation.id,
      type: simulation.type,
      message: `Allocated ${sizeMb}MB of memory`,
      parameters: simulation.parameters,
      totalAllocatedMb: MemoryPressureService.getTotalAllocatedMb(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/simulations/memory/:id
 *
 * Releases a memory allocation.
 *
 * @route DELETE /api/simulations/memory/:id
 * @param {string} id - Allocation ID (UUID)
 * @returns {SimulationResponse} Released allocation details
 */
memoryRouter.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate UUID format
    const id = validateUuid(req.params.id, 'id');

    // Try to release the memory
    const result = MemoryPressureService.release(id);

    if (result) {
      // Memory was actually released
      res.json({
        id: result.simulation?.id ?? id,
        type: 'MEMORY_PRESSURE',
        message: result.sizeMb > 0 ? `Released ${result.sizeMb}MB of memory` : 'Released memory allocation',
        status: result.simulation?.status ?? 'STOPPED',
        stoppedAt: result.simulation?.stoppedAt?.toISOString(),
        totalAllocatedMb: MemoryPressureService.getTotalAllocatedMb(),
      });
    } else {
      // Nothing found to release - return success anyway (idempotent delete)
      res.json({
        id: id,
        type: 'MEMORY_PRESSURE',
        message: 'Memory allocation already released or not found',
        status: 'STOPPED',
        totalAllocatedMb: MemoryPressureService.getTotalAllocatedMb(),
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/simulations/memory
 *
 * Lists active memory allocations.
 *
 * @route GET /api/simulations/memory
 * @returns {Object} List of active memory allocations
 */
memoryRouter.get('/', (_req: Request, res: Response) => {
  const allocations = MemoryPressureService.getActiveAllocations();

  res.json({
    allocations: allocations.map((alloc) => ({
      id: alloc.id,
      type: alloc.type,
      status: alloc.status,
      parameters: alloc.parameters,
      sizeMb: MemoryPressureService.getAllocationSize(alloc.id),
      startedAt: alloc.startedAt.toISOString(),
    })),
    count: allocations.length,
    totalAllocatedMb: MemoryPressureService.getTotalAllocatedMb(),
  });
});
