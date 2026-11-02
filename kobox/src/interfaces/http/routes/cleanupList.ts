import { CleanupProposal } from '../../../domain/space/CleanupProposal.js';
import type { CleanupSnapshotRepository } from '../../../domain/space/ports.js';
import { Quota } from '../../../domain/user/Quota.js';
import type { DiskUsageRepository, UserRepository } from '../../../domain/user/ports.js';
import type { Username } from '../../../domain/user/Username.js';
import type { CleanupList } from '../views/spaceCleanupPage.js';

export interface CleanupListDeps {
  readonly users: Pick<UserRepository, 'findByUsername'>;
  readonly diskSamples: Pick<DiskUsageRepository, 'find'>;
  readonly cleanupSnapshots: Pick<CleanupSnapshotRepository, 'find'>;
}

// What a member can clean, as the hourly pass judged it, checked as the
// proposal says. Never measured, the member is taken as using nothing, so no
// box is checked for them: the page never guesses what they hold. The member's
// pages and the admin's members list both read it from here, so they agree.
export async function cleanupListOf(
  deps: CleanupListDeps,
  username: Username,
): Promise<CleanupList | undefined> {
  const snapshot = await deps.cleanupSnapshots.find(username);
  const user = await deps.users.findByUsername(username);
  if (snapshot === undefined || user === undefined) {
    return undefined;
  }
  const sample = await deps.diskSamples.find(username);
  return {
    takenAt: snapshot.takenAt,
    judgedBy: snapshot.judgedBy,
    proposal: CleanupProposal.of({
      candidates: snapshot.candidates,
      used: sample?.used ?? Quota.bytes(0),
      allowance: user.quota,
    }),
  };
}
