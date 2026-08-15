import type { ComponentSpec } from '../../domain/installation/catalog.js';
import { planInstallation } from '../../domain/installation/InstallPlan.js';
import type {
  ComponentRegistry,
  PackagePort,
  SystemFactsPort,
} from '../../domain/installation/ports.js';
import { evaluatePreflight, type PreflightFailure } from '../../domain/installation/preflight.js';
import { Version } from '../../domain/installation/Version.js';
import type { ComponentInstaller } from './installers.js';

// The Phase 1-3 renders that make an installed box converge to desired state.
export const CONVERGENCE_JOBS = [
  'apply-firewall',
  'render-fail2ban',
  'render-whitelist',
  'render-openvpn',
] as const;

export type ConvergenceJobType = (typeof CONVERGENCE_JOBS)[number];

export class PreflightFailedError extends Error {
  constructor(readonly failures: readonly PreflightFailure[]) {
    super(
      ['preflight failed — nothing was changed:', ...failures.map((f) => `  - ${f.message}`)].join(
        '\n',
      ),
    );
    this.name = 'PreflightFailedError';
  }
}

export class ComponentInstallError extends Error {
  constructor(
    readonly component: string,
    cause: unknown,
  ) {
    super(
      `component ${component} failed: ${cause instanceof Error ? cause.message : String(cause)} — fix the cause and re-run kobox install (completed components are not redone)`,
    );
    this.name = 'ComponentInstallError';
  }
}

export interface InstallationReport {
  readonly installed: readonly string[];
  readonly skipped: readonly string[];
  readonly alreadyInstalled: readonly string[];
  readonly drainedJobs: number;
}

interface Deps {
  readonly facts: SystemFactsPort;
  readonly registry: ComponentRegistry;
  readonly packages: PackagePort;
  readonly installers: ReadonlyMap<string, ComponentInstaller>;
  readonly catalog: readonly ComponentSpec[];
  readonly enqueueConvergence: (type: ConvergenceJobType) => Promise<void>;
  readonly drain: () => Promise<number>;
  readonly now: () => string;
  readonly onProgress?: (line: string) => void;
}

// The orchestrator that replaces MySB.bsh: preflight gate, dependency-ordered
// resumable plan, truthful registry, deterministic stop at first failure
// (anti-#122), then in-process convergence through the same typed job queue
// production uses.
export class RunInstallation {
  constructor(private readonly deps: Deps) {}

  async execute(input: { readonly allowNonExt4: boolean }): Promise<InstallationReport> {
    const { deps } = this;
    const failures = evaluatePreflight(await deps.facts.gather(), {
      allowNonExt4: input.allowNonExt4,
    });
    if (failures.length > 0) {
      throw new PreflightFailedError(failures);
    }

    const states = await deps.registry.states();
    const plan = planInstallation(deps.catalog);
    const alreadyInstalled = deps.catalog
      .map((spec) => spec.name.value)
      .filter((name) => states.get(name)?.value === 'installed');

    // The pass always walks the whole catalog now, so "is there work" can no
    // longer be read off its length: a fully converged box still pays no
    // apt-get update, it just walks its components and finds each one done.
    if (alreadyInstalled.length < deps.catalog.length) {
      await deps.packages.refresh();
    }

    const installed: string[] = [];
    const skipped: string[] = [];
    for (const spec of plan) {
      const name = spec.name.value;
      const installer = deps.installers.get(name);
      if (!installer) {
        throw new ComponentInstallError(name, new Error('no installer registered'));
      }
      this.deps.onProgress?.(`installing ${name}…`);
      try {
        const outcome = await installer.install();
        if (outcome.state === 'skipped') {
          await deps.registry.markSkipped(spec.name, outcome.reason, deps.now());
          skipped.push(name);
          this.deps.onProgress?.(`${name}: skipped — ${outcome.reason}`);
        } else {
          await deps.registry.markInstalled(
            spec.name,
            outcome.version === undefined ? undefined : Version.parse(outcome.version),
            deps.now(),
          );
          // `installed` reports what THIS pass changed, not everything it
          // walked: the plan now revisits converged components, and a report
          // that re-lists all of them every run tells an operator nothing.
          if (!alreadyInstalled.includes(name)) {
            installed.push(name);
          }
          this.deps.onProgress?.(
            `${name}: installed${outcome.detail === undefined ? '' : ` — ${outcome.detail}`}`,
          );
        }
      } catch (error) {
        await deps.registry.markFailed(
          spec.name,
          error instanceof Error ? error.message : String(error),
          deps.now(),
        );
        throw new ComponentInstallError(name, error);
      }
    }

    for (const type of CONVERGENCE_JOBS) {
      await deps.enqueueConvergence(type);
    }
    const drainedJobs = await deps.drain();
    return { installed, skipped, alreadyInstalled, drainedJobs };
  }
}
