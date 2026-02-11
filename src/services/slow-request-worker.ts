/**
 * Slow Request Worker
 *
 * Runs as a Worker Thread to block for a specified duration.
 * Similar to .NET ThreadPool work item blocking patterns.
 *
 * @module services/slow-request-worker
 */

import { parentPort, workerData } from 'worker_threads';
import { pbkdf2Sync } from 'crypto';

const { durationMs } = workerData as { durationMs: number };

/**
 * Blocks the worker thread for the specified duration using CPU-intensive work.
 * This simulates a blocked ThreadPool thread in .NET.
 */
function blockForDuration(): void {
  const endTime = Date.now() + durationMs;
  
  while (Date.now() < endTime) {
    // CPU-intensive sync operation to keep the worker busy
    pbkdf2Sync('password', 'salt', 1000, 64, 'sha512');
  }
  
  // Signal completion back to parent
  if (parentPort) {
    parentPort.postMessage({ status: 'completed', durationMs });
  }
}

blockForDuration();
