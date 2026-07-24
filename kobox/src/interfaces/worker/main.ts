#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { parseJob } from '../../application/jobs/contract.js';
import { ensureSpoolDir } from '../../infrastructure/spool/TorrentEventSpool.js';
import { buildContainer, spoolDir, type Container } from '../composition.js';

// Converts spooled rtorrent events (owner-authenticated files) into typed
// jobs; anything the contract rejects is logged and dropped, never fatal.
async function sweepSpool(c: Container): Promise<void> {
  for (const event of await c.spoolSweeper.sweep()) {
    try {
      await c.queue.enqueue(parseJob('torrent-event', event.payload));
    } catch (error) {
      c.logger.warn(
        { username: event.username, error: error instanceof Error ? error.message : String(error) },
        'invalid torrent event dropped',
      );
    }
  }
}

// The root worker: the only process that both reads the queue and touches
// infrastructure/system. Runs as a systemd service in production; --once
// sweeps the event spool, drains the queue and exits (tests, cron setups).
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
    ensureSpoolDir(spoolDir());
    const recovered = await c.queue.recoverStale();
    if (recovered > 0) {
      c.logger.warn({ recovered }, 'stale running jobs marked failed');
    }
    if (once) {
      await sweepSpool(c);
      const count = await c.worker.drain();
      c.logger.info({ count }, 'queue drained');
      return;
    }
    while (!signal.stopping) {
      await sweepSpool(c);
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
