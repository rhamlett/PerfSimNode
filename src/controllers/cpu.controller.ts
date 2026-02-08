/**
 * CPU Controller
 *
 * Handles CPU stress simulation endpoints.
 *
 * @module controllers/cpu
 */

import { Router, Request, Response, NextFunction } from 'express';
import { CpuStressService } from '../services/cpu-stress.service';
import { SimulationTrackerService } from '../services/simulation-tracker.service';
import { validateCpuStressParams, validateUuid } from '../middleware/validation';
import { NotFoundError } from '../middleware/error-handler';

/**
 * Express router for CPU simulation endpoints.
 */
export const cpuRouter = Router();

/**
 * POST /api/simulations/cpu
 *
 * Starts a new CPU stress simulation.
 *
 * @route POST /api/simulations/cpu
 * @body {number} targetLoadPercent - Target CPU load percentage (1-100)
 * @body {number} durationSeconds - Duration in seconds (1-300)
 * @returns {SimulationResponse} Created simulation details
 */
cpuRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input parameters
    const { targetLoadPercent, durationSeconds } = validateCpuStressParams(
      req.body.targetLoadPercent,
      req.body.durationSeconds
    );

    // Start the simulation
    const simulation = CpuStressService.start({ targetLoadPercent, durationSeconds });

    res.status(201).json({
      id: simulation.id,
      type: simulation.type,
      message: `CPU stress simulation started at ${targetLoadPercent}% for ${durationSeconds}s`,
      parameters: simulation.parameters,
      scheduledEndAt: simulation.scheduledEndAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/simulations/cpu/:id
 *
 * Stops a running CPU stress simulation.
 *
 * @route DELETE /api/simulations/cpu/:id
 * @param {string} id - Simulation ID (UUID)
 * @returns {SimulationResponse} Stopped simulation details
 */
cpuRouter.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate UUID format
    const id = validateUuid(req.params.id, 'id');

    // Check if simulation exists and is a CPU stress simulation
    const simulation = SimulationTrackerService.getSimulation(id);
    if (!simulation) {
      throw new NotFoundError('Simulation not found');
    }

    if (simulation.type !== 'CPU_STRESS') {
      throw new NotFoundError('Simulation not found (not a CPU stress simulation)');
    }

    if (simulation.status !== 'ACTIVE') {
      throw new NotFoundError('Simulation is not active');
    }

    // Stop the simulation
    const stoppedSimulation = CpuStressService.stop(id);

    if (!stoppedSimulation) {
      throw new NotFoundError('Failed to stop simulation');
    }

    res.json({
      id: stoppedSimulation.id,
      type: stoppedSimulation.type,
      message: 'CPU stress simulation stopped',
      status: stoppedSimulation.status,
      stoppedAt: stoppedSimulation.stoppedAt?.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/simulations/cpu
 *
 * Lists active CPU stress simulations.
 *
 * @route GET /api/simulations/cpu
 * @returns {Object} List of active CPU stress simulations
 */
cpuRouter.get('/', (_req: Request, res: Response) => {
  const simulations = CpuStressService.getActiveSimulations();

  res.json({
    simulations: simulations.map((sim) => ({
      id: sim.id,
      type: sim.type,
      status: sim.status,
      parameters: sim.parameters,
      startedAt: sim.startedAt.toISOString(),
      scheduledEndAt: sim.scheduledEndAt.toISOString(),
    })),
    count: simulations.length,
  });
});
