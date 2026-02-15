/**
 * =============================================================================
 * CPU WORKER PROCESS — Forked Child That Burns One CPU Core at 100%
 * =============================================================================
 *
 * PURPOSE:
 *   This file is the ENTRY POINT for a forked child process. It is NOT imported
 *   — it is spawned via child_process.fork() from CpuStressService.
 *   Each instance burns exactly one CPU core at 100% utilization.
 *
 * EXECUTION MODEL:
 *   - Spawned by: CpuStressService.start() via child_process.fork(__filename)
 *   - Each forked process = 1 OS process = 1 CPU core pinned at 100%
 *   - The parent spawns N workers (one per target core)
 *   - Communication: IPC messages between parent <-> child
 *     - Child sends 'ready' when initialized
 *     - Parent sends 'stop' to gracefully terminate
 *
 * HOW IT BURNS CPU:
 *   A tight while(true) loop calling pbkdf2Sync (PBKDF2 with 10,000 iterations).
 *   Each call takes ~5-10ms of pure CPU work. The loop runs until 'stop' is
 *   received. Since this is a SEPARATE PROCESS, blocking the event loop is
 *   intentional and will not affect the main app.
 *
 * PORTING NOTES:
 *   - Java: Implement as a Runnable submitted to an ExecutorService.
 *     Use a while(!Thread.interrupted()) loop with MessageDigest work.
 *   - Python: Use multiprocessing.Process (NOT threading — GIL prevents
 *     true parallelism with threads). hashlib.pbkdf2_hmac in a while loop.
 *   - C#: Task.Run() with a while(!cancellationToken.IsCancellationRequested)
 *     loop using Rfc2898DeriveBytes for CPU-intensive work.
 *   - PHP: pcntl_fork() or a separate CLI script invoked via proc_open().
 *
 *   The key insight: Node.js uses separate PROCESSES (not threads) because
 *   Node's single-threaded model means threads would share the event loop.
 *   Java/C# can use threads since they have true multi-threading.
 *
 * @module services/cpu-worker
 */

import { pbkdf2Sync } from 'crypto';

let running = true;

/**
 * IPC message handler: parent sends 'stop' to gracefully terminate.
 * In Java/C#, this would be a Thread.interrupt() or CancellationToken.
 */
process.on('message', (msg: string) => {
  if (msg === 'stop') {
    running = false;
    process.exit(0);
  }
});

/** OS signal handler for graceful shutdown (e.g., parent process killed). */
process.on('SIGTERM', () => {
  running = false;
  process.exit(0);
});

/**
 * Main CPU burn loop. Runs synchronously until stopped.
 *
 * ALGORITHM:
 *   1. Send 'ready' message to parent (signals successful initialization)
 *   2. Enter tight while(running) loop
 *   3. Each iteration: pbkdf2Sync with 10,000 rounds (~5-10ms of pure CPU)
 *   4. Loop exits when IPC message sets running=false
 *
 * The choice of pbkdf2Sync is deliberate:
 *   - Cryptographic work that cannot be optimized away by the JIT compiler
 *   - Predictable duration per call (~5-10ms)
 *   - Available in all languages' standard libraries
 */
function burnCpu(): void {
  // Signal to parent that this worker is initialized and beginning work
  if (process.send) {
    process.send('ready');
  }
  
  while (running) {
    // PBKDF2 with 10,000 iterations: ~5-10ms of CPU-intensive synchronous work.
    // The sync variant is used intentionally to keep CPU at 100% without yielding.
    pbkdf2Sync('password', 'salt', 10000, 64, 'sha512');
  }
}

burnCpu();
