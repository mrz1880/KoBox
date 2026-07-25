import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../bootstrap/install.sh',
);

// The irreducible bash (~50 lines): syntax-checked here, exercised for real
// by the installation E2E. Everything after `exec` is TypeScript.
describe('bootstrap/install.sh', () => {
  it('should_be_valid_bash', async () => {
    await expect(execFileAsync('bash', ['-n', SCRIPT])).resolves.toBeDefined();
  });

  it('should_stay_minimal_and_fail_fast', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(content).toContain('set -euo pipefail');
    // the whole point of the rewrite: bash hands off to the tested CLI
    expect(content).toContain('exec node');
    const codeLines = content
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
    expect(codeLines.length).toBeLessThanOrEqual(50);
  });

  it('should_pass_shellcheck_when_available', async () => {
    const hasShellcheck = await execFileAsync('shellcheck', ['--version']).then(
      () => true,
      () => false,
    );
    if (!hasShellcheck) {
      return; // optional tool — the container/CI path has it via apt when needed
    }
    await expect(execFileAsync('shellcheck', [SCRIPT])).resolves.toBeDefined();
  });
});
