import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecFileRunner } from '../../../src/infrastructure/system/CommandRunner.js';
import { GitAdapter } from '../../../src/infrastructure/system/GitAdapter.js';

let dir: string;
let repo: string;
let clone: string;
const git = new GitAdapter(new ExecFileRunner());

// Every repo here is a scratch fixture created by the test — the checkout
// running this suite is NEVER touched (its .git must stay pristine).
function sh(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.org',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.org',
    },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-git-'));
  repo = join(dir, 'origin');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'file.txt'), 'v1\n');
  sh(repo, ['add', '.']);
  sh(repo, ['commit', '-q', '-m', 'v1']);
  sh(repo, ['tag', 'v1.0.0']);
  writeFileSync(join(repo, 'file.txt'), 'v2\n');
  sh(repo, ['commit', '-aqm', 'v2']);
  sh(repo, ['tag', 'v2.0.0']);
  clone = join(dir, 'clone');
  execFileSync('git', ['clone', '-q', `file://${repo}`, clone]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('GitAdapter (real git, scratch repos only)', () => {
  it('should_fetch_and_answer_ref_existence', async () => {
    sh(repo, ['tag', 'v3.0.0']); // created upstream AFTER the clone

    expect(await git.refExists(clone, 'v3.0.0')).toBe(false);
    await git.fetch(clone);
    expect(await git.refExists(clone, 'v3.0.0')).toBe(true);
    expect(await git.refExists(clone, 'does-not-exist')).toBe(false);
  });

  it('should_resolve_a_ref_to_its_commit_sha', async () => {
    const sha = await git.resolveRef(clone, 'v1.0.0');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sha).not.toBe(await git.resolveRef(clone, 'v2.0.0'));
  });

  it('should_add_and_remove_a_worktree_at_a_pinned_ref', async () => {
    const worktree = join(dir, 'releases', 'v1');

    await git.worktreeAdd(clone, worktree, 'v1.0.0');

    expect(existsSync(join(worktree, 'file.txt'))).toBe(true);
    expect(sh(worktree, ['log', '-1', '--format=%s']).trim()).toBe('v1');
    // the source clone stays on its own branch, untouched
    expect(sh(clone, ['status', '--porcelain']).trim()).toBe('');

    await git.worktreeRemove(clone, worktree);
    expect(existsSync(worktree)).toBe(false);
  });

  it('should_refuse_nothing_but_report_current_ref', async () => {
    expect(await git.currentRef(clone)).toMatch(/^[0-9a-f]{40}$/);
  });
});
