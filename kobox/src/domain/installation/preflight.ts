import type { SystemFacts } from './ports.js';

export type PreflightCheck = 'os' | 'root' | 'arch' | 'filesystem' | 'network';

export interface PreflightFailure {
  readonly check: PreflightCheck;
  readonly message: string;
}

export interface PreflightOptions {
  readonly allowNonExt4: boolean;
}

const SUPPORTED_ARCHS = ['amd64', 'arm64'];

// Pure gate: ALL failures are reported at once (the operator fixes everything
// in one pass), and the orchestrator refuses to mutate anything while this
// returns a non-empty list — the anti-brick contract (#122/#100/#119).
export function evaluatePreflight(
  facts: SystemFacts,
  options: PreflightOptions,
): readonly PreflightFailure[] {
  const failures: PreflightFailure[] = [];
  if (facts.osId !== 'debian' || facts.osVersionId !== '12') {
    failures.push({
      check: 'os',
      message: `KoBox targets Debian 12 (bookworm); found ${facts.osId} ${facts.osVersionId}`,
    });
  }
  if (facts.euid !== 0) {
    failures.push({
      check: 'root',
      message: `kobox install must run as root (euid 0); found euid ${String(facts.euid)}`,
    });
  }
  if (!SUPPORTED_ARCHS.includes(facts.arch)) {
    failures.push({
      check: 'arch',
      message: `unsupported architecture ${facts.arch}; supported: ${SUPPORTED_ARCHS.join(', ')}`,
    });
  }
  if (facts.rootFsType !== 'ext4' && !options.allowNonExt4) {
    failures.push({
      check: 'filesystem',
      message: `root filesystem is ${facts.rootFsType}, quotas need ext4 — re-run with --allow-non-ext4 to proceed anyway (containers/VMs)`,
    });
  }
  if (!facts.hasDefaultRoute) {
    failures.push({
      check: 'network',
      message: 'no default route — apt needs outbound network before installing anything',
    });
  }
  return failures;
}
