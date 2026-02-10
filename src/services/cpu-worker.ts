/**
 * CPU Worker Thread
 *
 * Runs in a separate thread to burn CPU cycles.
 * Receives burn parameters via parentPort messages.
 *
 * @module services/cpu-worker
 */

import { parentPort, workerData } from 'worker_threads';
import { pbkdf2Sync } from 'crypto';

interface WorkerConfig {
  targetLoadPercent: number;
  intervalMs: number;
}

const config: WorkerConfig = workerData || { targetLoadPercent: 50, intervalMs: 100 };

let running = true;

/**
 * Performs CPU-intensive work for approximately the specified duration.
 */
function cpuBurn(durationMs: number): void {
  const endTime = Date.now() + durationMs;
  while (Date.now() < endTime) {
    // Each call consumes ~1-2ms of CPU time
    pbkdf2Sync('password', 'salt', 1000, 64, 'sha512');
  }
}

/**
 * Main burn loop - runs continuously until stopped.
 */
function burnLoop(): void {
  const burnTimeMs = (config.targetLoadPercent / 100) * config.intervalMs;
  const sleepTimeMs = config.intervalMs - burnTimeMs;

  const tick = () => {
    if (!running) return;

    // Burn CPU
    cpuBurn(burnTimeMs);

    // Schedule next tick after sleep
    setTimeout(tick, sleepTimeMs);
  };

  tick();
}

// Listen for messages from parent
parentPort?.on('message', (msg: string) => {
  if (msg === 'stop') {
    running = false;
    parentPort?.postMessage('stopped');
    process.exit(0);
  }
});

// Start burning
burnLoop();

// Notify parent we're ready
parentPort?.postMessage('ready');
