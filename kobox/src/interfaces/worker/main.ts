#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { buildContainer } from '../composition.js';

// The root worker: the only process that both reads the queue and touches
// infrastructure/system. Runs as a systemd service in production; --once
// drains the queue and exits (used by tests and cron-style setups).
async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const c = buildContainer('kobox-worker');
  const signal = { stopping: false };
  const stop = (name: string) => {
    c.logger.info({ signal: name }, 'stopping after current job');
    signal.stopping = true;
  };
  process.on('SIGTERM', () => { stop('SIGTERM'); });
  process.on('SIGINT', () => { stop('SIGINT'); });
  c.logger.info({ once }, 'kobox worker started');
  try {
    const recovered = await c.queue.recoverStale();
    if (recovered > 0) {
      c.logger.warn({ recovered }, 'stale running jobs marked failed');
    }
    if (once) {
      const count = await c.worker.drain();
      c.logger.info({ count }, 'queue drained');
      return;
    }
    while (!signal.stopping) {
      const processed = await c.worker.processNext();
      if (!processed) {
        await sleep(1000);
      }
    }
  } finally {
    c.db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
