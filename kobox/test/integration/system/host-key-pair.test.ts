import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FsHostKeyPair } from '../../../src/infrastructure/system/HostKeyPair.js';

let pub: string;
let priv: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'kobox-host-keys-'));
  pub = join(dir, 'host-pub.pem');
  priv = join(dir, 'host-key.pem');
});

describe('host key pair provisioning', () => {
  it('should_generate_a_usable_pair_with_a_root_only_private_half', async () => {
    await new FsHostKeyPair(pub, priv).ensurePair();

    expect(readFileSync(priv, 'utf8')).toContain('BEGIN PRIVATE KEY');
    expect(readFileSync(pub, 'utf8')).toContain('BEGIN PUBLIC KEY');
    // the private half must not be readable by group or other
    expect(statSync(priv).mode & 0o077).toBe(0);
    // the portal (another uid) must be able to read the public half
    expect(statSync(pub).mode & 0o044).toBe(0o044);
  });

  it('should_never_regenerate_over_an_existing_private_key', async () => {
    const keys = new FsHostKeyPair(pub, priv);
    await keys.ensurePair();
    const first = readFileSync(priv, 'utf8');

    await keys.ensurePair();
    await keys.ensurePair();

    // regenerating would silently orphan every sealed value
    expect(readFileSync(priv, 'utf8')).toBe(first);
  });

  it('should_rederive_a_missing_public_half_instead_of_minting_a_new_pair', async () => {
    const keys = new FsHostKeyPair(pub, priv);
    await keys.ensurePair();
    const privateBefore = readFileSync(priv, 'utf8');
    const publicBefore = readFileSync(pub, 'utf8');
    execFileSync('rm', [pub]);

    await keys.ensurePair();

    expect(readFileSync(priv, 'utf8')).toBe(privateBefore);
    expect(readFileSync(pub, 'utf8')).toBe(publicBefore); // derived, identical
  });
});
