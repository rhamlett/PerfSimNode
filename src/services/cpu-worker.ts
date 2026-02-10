/**
 * CPU Worker Thread
 *
 * Runs in a separate thread burning CPU at 100%.
 * Total system CPU is controlled by number of workers spawned.
 *
 * @module services/cpu-worker
 */

import { parentPort } from 'worker_threads';
import { createHash } from 'crypto';

let running = true;

// Listen for stop message
parentPort?.on('message', (msg: string) => {
  if (msg === 'stop') {
    running = false;
    process.exit(0);
  }
});

/**
 * Burns CPU continuously using crypto operations.
 * This is a tight loop that will use 100% of one CPU core.
 */
function burnCpu(): void {
  let counter = 0;
  while (running) {
    // Use crypto hash which is CPU-intensive
    createHash('sha256').update(`burn${counter++}`).digest();
    
    // Check for stop every 10000 iterations to stay responsive
    if (counter % 10000 === 0 && !running) break;
  }
}

// Start burning immediately
parentPort?.postMessage('ready');
burnCpu();
