/**
 * CPU Worker Thread
 *
 * Runs in a separate thread to burn CPU cycles.
 * Uses a tight synchronous loop for maximum CPU utilization.
 *
 * @module services/cpu-worker
 */

import { parentPort, workerData } from 'worker_threads';
import { pbkdf2Sync } from 'crypto';

interface WorkerConfig {
  targetLoadPercent: number;
}

const config: WorkerConfig = workerData || { targetLoadPercent: 100 };

let running = true;

// Listen for messages from parent
parentPort?.on('message', (msg: string) => {
  if (msg === 'stop') {
    running = false;
    parentPort?.postMessage('stopped');
    process.exit(0);
  }
});

/**
 * Main burn loop - synchronous tight loop for maximum CPU burn.
 * Uses a duty cycle within each 10ms window.
 */
function burnLoop(): void {
  const cycleMs = 10; // 10ms cycle for precision
  const burnMs = (config.targetLoadPercent / 100) * cycleMs;
  
  while (running) {
    const cycleStart = Date.now();
    const burnEnd = cycleStart + burnMs;
    
    // Burn phase - tight loop with actual work
    while (Date.now() < burnEnd && running) {
      // Heavy crypto work - this actually burns CPU
      pbkdf2Sync('password', 'salt', 500, 64, 'sha512');
    }
    
    // Idle phase - busy wait to complete the cycle
    // Using a loop instead of setTimeout for precision
    const cycleEnd = cycleStart + cycleMs;
    while (Date.now() < cycleEnd && running) {
      // Yield briefly to prevent 100% when we should be idling
      // Empty loop just checks time
    }
  }
}

// Notify parent we're ready and start burning
parentPort?.postMessage('ready');
burnLoop();

// Start burning
burnLoop();

// Notify parent we're ready
parentPort?.postMessage('ready');
