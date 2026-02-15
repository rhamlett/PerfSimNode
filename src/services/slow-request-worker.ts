/**
 * =============================================================================
 * SLOW REQUEST WORKER — Worker Thread for Blocking Delay Pattern
 * =============================================================================
 *
 * PURPOSE:
 *   This file is the ENTRY POINT for a Worker Thread (not a child process).
 *   It is spawned by SlowRequestService when blockingPattern='worker'.
 *   The Worker Thread blocks for a specified duration, simulating a thread
 *   pool thread that is stuck processing (like a blocked .NET ThreadPool thread).
 *
 * WORKER THREADS vs CHILD PROCESSES:
 *   - cpu-worker.ts uses child_process.fork() = separate OS PROCESS
 *   - This file uses worker_threads = separate THREAD within same process
 *   - Worker Threads share memory (via SharedArrayBuffer) but have their own
 *     V8 isolate and event loop. They are lighter than child processes.
 *
 * EXECUTION MODEL:
 *   - Spawned by: SlowRequestService via new Worker(__filename, { workerData })
 *   - Receives duration via workerData (passed at construction time)
 *   - Blocks for exactly durationMs using synchronous crypto work
 *   - Sends 'completed' message back to parent via parentPort.postMessage()
 *   - Worker Thread automatically terminates after the function returns
 *
 * PORTING NOTES:
 *   - Java: Submit a Callable to a ThreadPoolExecutor that calls
 *     Thread.sleep(durationMs) or performs busy-wait with MessageDigest.
 *   - Python: threading.Thread with time.sleep() or busy-wait
 *     (Python threads are real OS threads but limited by GIL for CPU work).
 *   - C#: Task.Run(() => Thread.Sleep(durationMs)) blocks a ThreadPool thread.
 *   - PHP: No native thread support; use sleep() in the request handler,
 *     or pthreads extension for true threading.
 *
 * @module services/slow-request-worker
 */

import { parentPort, workerData } from 'worker_threads';
import { pbkdf2Sync } from 'crypto';

/** Duration to block, passed from parent via workerData at thread creation. */
const { durationMs } = workerData as { durationMs: number };

/**
 * Blocks the worker thread for exactly durationMs using CPU-intensive work.
 *
 * ALGORITHM:
 *   1. Calculate end time = now + durationMs
 *   2. Loop while now < endTime, calling pbkdf2Sync each iteration
 *   3. Each pbkdf2Sync call takes ~1ms (1,000 iterations vs 10,000 in cpu-worker)
 *   4. When time expires, send completion message to parent
 *
 * WHY pbkdf2Sync AND NOT setTimeout:
 *   Worker Threads have their own event loop and could use setTimeout.
 *   However, pbkdf2Sync guarantees CPU utilization during the wait,
 *   which is more realistic for simulating a busy thread (vs. an idle sleep).
 */
function blockForDuration(): void {
  const endTime = Date.now() + durationMs;
  
  while (Date.now() < endTime) {
    // Lower iteration count (1,000) than cpu-worker (10,000) for finer time granularity
    pbkdf2Sync('password', 'salt', 1000, 64, 'sha512');
  }
  
  // Signal completion back to parent thread via message passing
  if (parentPort) {
    parentPort.postMessage({ status: 'completed', durationMs });
  }
}

blockForDuration();
