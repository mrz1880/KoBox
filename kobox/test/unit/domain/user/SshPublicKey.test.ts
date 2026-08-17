import { describe, expect, it } from 'vitest';
import { InvalidSshPublicKeyError, SshPublicKey } from '../../../../src/domain/user/SshPublicKey.js';

const ED25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7Kk1p2vQ0Hn3xYqZ8mLsRtWuVdEfGhIjKlMnOpQrSt';

describe('SshPublicKey', () => {
  it('should_accept_a_key_a_member_would_actually_paste', () => {
    const key = SshPublicKey.parse(`${ED25519} laptop@home`);

    expect(key.type).toBe('ssh-ed25519');
    expect(key.comment).toBe('laptop@home');
  });

  it('should_refuse_a_line_that_carries_its_own_options', () => {
    // authorized_keys options come BEFORE the type. Accepting a pasted line
    // with options would let a member grant themselves a pty, port forwarding
    // or a forced command, which is exactly what KoBox adds on purpose.
    expect(() => SshPublicKey.parse(`command="sh" ${ED25519}`)).toThrow(InvalidSshPublicKeyError);
    expect(() => SshPublicKey.parse(`no-pty,${ED25519}`)).toThrow(InvalidSshPublicKeyError);
  });

  it('should_refuse_more_than_one_line', () => {
    // one field, one key: a second line would smuggle in an unrestricted entry
    expect(() => SshPublicKey.parse(`${ED25519}\n${ED25519}`)).toThrow(InvalidSshPublicKeyError);
  });

  it('should_refuse_a_private_key_pasted_by_mistake', () => {
    expect(() => SshPublicKey.parse('-----BEGIN OPENSSH PRIVATE KEY-----')).toThrow(
      InvalidSshPublicKeyError,
    );
  });

  it('should_refuse_a_type_nobody_should_still_be_using', () => {
    expect(() => SshPublicKey.parse('ssh-dss AAAAB3NzaC1kc3MAAACBAJ')).toThrow(
      InvalidSshPublicKeyError,
    );
  });
});
