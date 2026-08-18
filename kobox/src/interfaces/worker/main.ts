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
// how often the worker asks aria2 where a download is up to. Five seconds is
// short enough that a bar moves while somebody is looking at it, and long
// enough that a box with nothing running does one cheap query per five seconds.
const DEBRID_POLL_INTERVAL_MS = 5_000;

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
    // Daemon mode = systemd service = every boot: the oneshot restores the
    // filter table from the persisted file, but the nat masquerade lives
    // outside the ruleset (shared table) — reconverge it here.
    await c.queue.enqueue(parseJob('apply-firewall', {}));
    // A download's progress used to come only from the */2 cron entry, so the
    // bar moved at best every two minutes and most downloads were long finished
    // before it moved at all. Cron cannot go below a minute; this loop is
    // already awake every second, holds the aria2 secret, and the poll is a
    // single indexed SELECT when nothing is active. The cron entry stays as the
    // net that catches a worker which was down while something finished.
    let nextDebridPoll = 0;
    while (!signal.stopping) {
      await sweepSpool(c);
      if (Date.now() >= nextDebridPoll) {
        nextDebridPoll = Date.now() + DEBRID_POLL_INTERVAL_MS;
        await c.ddlUseCases.pollDownloads.execute().catch((error: unknown) => {
          // one bad poll must not stop the queue from draining
          c.logger.warn({ err: error }, 'debrid poll failed');
        });
      }
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
