import type { CleanupReport } from '../../domain/space/CleanupReport.js';
import type { CleanupReportRepository } from '../../domain/space/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryCleanupReportRepository implements CleanupReportRepository {
  private readonly reports = new Map<string, CleanupReport>();

  save(username: Username, report: CleanupReport): Promise<void> {
    this.reports.set(username.value, report);
    return Promise.resolve();
  }

  find(username: Username): Promise<CleanupReport | undefined> {
    return Promise.resolve(this.reports.get(username.value));
  }
}
