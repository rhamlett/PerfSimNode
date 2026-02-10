/**
 * CPU Worker Process
 *
 * Runs as a separate OS process burning CPU at 100%.
 * Spawned via child_process.fork() for guaranteed core isolation.
 *
 * @module services/cpu-worker
 */

import { pbkdf2Sync } from 'crypto';

let running = true;

// Listen for stop signal from parent
process.on('message', (msg: string) => {
  if (msg === 'stop') {
    running = false;
    process.exit(0);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  running = false;
  process.exit(0);
});

/**
 * Burns CPU continuously - tight synchronous loop.
 * Since this is a separate process, blocking is fine.
 */
function burnCpu(): void {
  // Signal ready
  if (process.send) {
    process.send('ready');
  }
  
  while (running) {
    // Heavy PBKDF2 - ~5-10ms per call, keeps CPU at 100%
    pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
  }
}

burnCpu();
