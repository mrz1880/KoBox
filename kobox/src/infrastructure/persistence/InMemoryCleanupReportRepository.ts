import type { CleanupReport, CleanupTrigger } from '../../domain/space/CleanupReport.js';
import type { CleanupReportRepository } from '../../domain/space/ports.js';
import type { Username } from '../../domain/user/Username.js';

export class InMemoryCleanupReportRepository implements CleanupReportRepository {
  // keyed by member, then by trigger: one report of each per member
  private readonly reports = new Map<string, Map<CleanupTrigger, CleanupReport>>();

  save(username: Username, report: CleanupReport): Promise<void> {
    const ofMember = this.reports.get(username.value) ?? new Map<CleanupTrigger, CleanupReport>();
    ofMember.set(report.trigger, report);
    this.reports.set(username.value, ofMember);
    return Promise.resolve();
  }

  // stamps compare as strings in time
  find(username: Username): Promise<CleanupReport | undefined> {
    const all = [...(this.reports.get(username.value)?.values() ?? [])];
    return Promise.resolve(
      all.reduce<CleanupReport | undefined>(
        (latest, report) => (latest === undefined || report.at > latest.at ? report : latest),
        undefined,
      ),
    );
  }

  findTriggeredBy(username: Username, trigger: CleanupTrigger): Promise<CleanupReport | undefined> {
    return Promise.resolve(this.reports.get(username.value)?.get(trigger));
  }
}
