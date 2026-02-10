/**
 * CPU Worker Thread
 *
 * Runs in a separate thread burning CPU at 100%.
 * Uses multiple CPU-intensive techniques for maximum burn.
 *
 * @module services/cpu-worker
 */

import { parentPort } from 'worker_threads';
import { pbkdf2Sync } from 'crypto';

let running = true;

// Listen for stop message
parentPort?.on('message', (msg: string) => {
  if (msg === 'stop') {
    running = false;
    process.exit(0);
  }
});

/**
 * Burns CPU continuously using PBKDF2 which is extremely CPU-intensive.
 * This is a tight loop that will use 100% of one CPU core.
 */
function burnCpu(): void {
  while (running) {
    // PBKDF2 is designed to be CPU-intensive - this is the gold standard for CPU burn
    // 10000 iterations takes ~5-10ms and keeps the CPU fully busy
    pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
  }
}

// Start burning immediately
parentPort?.postMessage('ready');
burnCpu();
