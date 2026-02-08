/**
 * Memory Controller
 *
 * Handles memory pressure simulation endpoints.
 *
 * @module controllers/memory
 */

import { Router, Request, Response, NextFunction } from 'express';
import { MemoryPressureService } from '../services/memory-pressure.service';
import { SimulationTrackerService } from '../services/simulation-tracker.service';
import { validateMemoryPressureParams, validateUuid } from '../middleware/validation';
import { NotFoundError } from '../middleware/error-handler';

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
 * @body {number} sizeMb - Memory to allocate in megabytes (1-500)
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

    // Check if simulation exists
    const simulation = SimulationTrackerService.getSimulation(id);
    if (!simulation) {
      throw new NotFoundError('Memory allocation not found');
    }

    if (simulation.type !== 'MEMORY_PRESSURE') {
      throw new NotFoundError('Not a memory allocation');
    }

    // Get size before releasing
    const sizeMb = MemoryPressureService.getAllocationSize(id);

    // Release the memory
    const releasedSimulation = MemoryPressureService.release(id);

    if (!releasedSimulation) {
      throw new NotFoundError('Failed to release memory allocation');
    }

    res.json({
      id: releasedSimulation.id,
      type: releasedSimulation.type,
      message: `Released ${sizeMb}MB of memory`,
      status: releasedSimulation.status,
      stoppedAt: releasedSimulation.stoppedAt?.toISOString(),
      totalAllocatedMb: MemoryPressureService.getTotalAllocatedMb(),
    });
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
