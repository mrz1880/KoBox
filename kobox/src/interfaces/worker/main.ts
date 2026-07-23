#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { buildContainer } from '../composition.js';

// The root worker: the only process that both reads the queue and touches
// infrastructure/system. Runs as a systemd service in production; --once
// drains the queue and exits (used by tests and cron-style setups).
async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const c = buildContainer('kobox-worker');
  c.logger.info({ once }, 'kobox worker started');
  try {
    if (once) {
      const count = await c.worker.drain();
      c.logger.info({ count }, 'queue drained');
      return;
    }
    for (;;) {
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
