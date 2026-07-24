import type { Bandwidth } from '../../domain/security/Bandwidth.js';
import type { ShapingPort } from '../../domain/security/ports.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const TC_TIMEOUT_MS = 10_000;

// Per-user egress shaping: an fw-mark set in the mangle table by uid (owner
// match), classified into an HTB class per user. The mangle table is owned
// HERE and never rendered into the firewall ruleset, so a firewall re-apply
// keeps live throttles. tc parses class/handle minors as hex — the uid is
// hex-encoded consistently on both sides of the filter.
export class TcShapingAdapter implements ShapingPort {
  constructor(
    private readonly runner: CommandRunner,
    private readonly wanIf: string,
  ) {}

  async throttle(_username: Username, uid: number, rate: Bandwidth): Promise<void> {
    await this.ensureRootQdisc();
    const minor = uid.toString(16);
    await this.tc([
      'class', 'replace', 'dev', this.wanIf, 'parent', '1:',
      'classid', `1:${minor}`, 'htb', 'rate', rate.toTcRate(),
    ]);
    await this.tc([
      'filter', 'replace', 'dev', this.wanIf, 'parent', '1:', 'protocol', 'ip',
      'prio', '1', 'handle', `0x${minor}`, 'fw', 'flowid', `1:${minor}`,
    ]);
    if (!(await this.markRuleExists(uid))) {
      await runOrThrow(this.runner, {
        command: 'iptables',
        args: this.markRuleArgs('-A', uid),
        timeoutMs: TC_TIMEOUT_MS,
      });
    }
  }

  async unthrottle(_username: Username, uid: number): Promise<void> {
    if (!(await this.isThrottled(uid))) {
      return;
    }
    const minor = uid.toString(16);
    await this.tc([
      'filter', 'del', 'dev', this.wanIf, 'parent', '1:', 'protocol', 'ip',
      'prio', '1', 'handle', `0x${minor}`, 'fw',
    ]);
    await this.tc(['class', 'del', 'dev', this.wanIf, 'parent', '1:', 'classid', `1:${minor}`]);
    if (await this.markRuleExists(uid)) {
      await runOrThrow(this.runner, {
        command: 'iptables',
        args: this.markRuleArgs('-D', uid),
        timeoutMs: TC_TIMEOUT_MS,
      });
    }
  }

  async isThrottled(uid: number): Promise<boolean> {
    const result = await this.runner.run({
      command: 'tc',
      args: ['class', 'show', 'dev', this.wanIf],
      timeoutMs: TC_TIMEOUT_MS,
    });
    return result.stdout.includes(`class htb 1:${uid.toString(16)} `);
  }

  private async ensureRootQdisc(): Promise<void> {
    const result = await this.runner.run({
      command: 'tc',
      args: ['qdisc', 'show', 'dev', this.wanIf],
      timeoutMs: TC_TIMEOUT_MS,
    });
    if (!result.stdout.includes('htb 1:')) {
      // add, never replace: replace would drop every other user's class
      await this.tc(['qdisc', 'add', 'dev', this.wanIf, 'root', 'handle', '1:', 'htb']);
    }
  }

  private async markRuleExists(uid: number): Promise<boolean> {
    const result = await this.runner.run({
      command: 'iptables',
      args: this.markRuleArgs('-C', uid),
      timeoutMs: TC_TIMEOUT_MS,
    });
    return result.exitCode === 0;
  }

  private markRuleArgs(op: '-A' | '-C' | '-D', uid: number): string[] {
    return [
      '-t', 'mangle', op, 'OUTPUT', '-m', 'owner', '--uid-owner', String(uid),
      '-j', 'MARK', '--set-mark', String(uid),
    ];
  }

  private async tc(args: readonly string[]): Promise<void> {
    await runOrThrow(this.runner, { command: 'tc', args: [...args], timeoutMs: TC_TIMEOUT_MS });
  }
}
