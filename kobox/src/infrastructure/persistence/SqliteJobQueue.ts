import { asc, eq, sql } from 'drizzle-orm';
import { parseJob, type Job } from '../../application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../application/jobs/JobQueuePort.js';
import type { KoboxDatabase } from './db.js';
import { jobs } from './schema.js';

export class SqliteJobQueue implements JobQueuePort {
  constructor(private readonly db: KoboxDatabase) {}

  enqueue(job: Job): Promise<number> {
    const inserted = this.db.orm
      .insert(jobs)
      .values({ type: job.type, payloadJson: JSON.stringify(job.payload) })
      .returning({ id: jobs.id })
      .get();
    return Promise.resolve(inserted.id);
  }

  // pending -> running flips inside one write transaction so two workers can
  // never claim the same job. Payload is re-parsed: the queue trusts nothing.
  claimNextPending(): Promise<ClaimedJob | undefined> {
    try {
      return Promise.resolve(this.claimSync());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private claimSync(): ClaimedJob | undefined {
    for (;;) {
      const claimed = this.db.orm.transaction(
        (tx) => {
          const row = tx
            .select()
            .from(jobs)
            .where(eq(jobs.status, 'pending'))
            .orderBy(asc(jobs.id))
            .limit(1)
            .get();
          if (!row) {
            return undefined;
          }
          tx.update(jobs)
            .set({ status: 'running', updatedAt: sql`(datetime('now'))` })
            .where(eq(jobs.id, row.id))
            .run();
          return row;
        },
        { behavior: 'immediate' },
      );
      if (!claimed) {
        return undefined;
      }
      try {
        const job = parseJob(claimed.type, JSON.parse(claimed.payloadJson));
        return { id: claimed.id, job };
      } catch (error) {
        // Poisoned row (tampering, contract drift): quarantine it and move on —
        // a bad payload must never take the worker down.
        this.setStatus(
          claimed.id,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  recoverStale(): Promise<number> {
    const result = this.db.orm
      .update(jobs)
      .set({ status: 'failed', error: 'interrupted: worker restarted', updatedAt: sql`(datetime('now'))` })
      .where(eq(jobs.status, 'running'))
      .run();
    return Promise.resolve(result.changes);
  }

  markDone(id: number): Promise<void> {
    this.setStatus(id, 'done', null);
    return Promise.resolve();
  }

  markFailed(id: number, error: string): Promise<void> {
    this.setStatus(id, 'failed', error);
    return Promise.resolve();
  }

  private setStatus(id: number, status: 'done' | 'failed', error: string | null): void {
    this.db.orm
      .update(jobs)
      .set({ status, error, updatedAt: sql`(datetime('now'))` })
      .where(eq(jobs.id, id))
      .run();
  }
}
