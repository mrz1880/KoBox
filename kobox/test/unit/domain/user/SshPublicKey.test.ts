import { describe, expect, it } from 'vitest';
import { InvalidSshPublicKeyError, SshPublicKey } from '../../../../src/domain/user/SshPublicKey.js';

const BODY = 'AAAAC3NzaC1lZDI1NTE5AAAAIB7Kk1p2vQ0Hn3xYqZ8mLsRtWuVdEfGhIjKlMnOpQrSt';
const ED25519 = `ssh-ed25519 ${BODY}`;
const NOT_BASE64 = 'invalid ssh public key: the key itself is not base64 of a plausible length';

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

  it('should_ignore_surrounding_whitespace_and_keep_an_absent_comment_empty', () => {
    const key = SshPublicKey.parse(`  ${ED25519}  \n`);

    expect(key.comment).toBe('');
    expect(key.toAuthorizedKeysLine()).toBe(`restrict,command="internal-sftp" ${ED25519}`);
  });

  it('should_restrict_the_key_to_file_transfer_and_keep_its_comment', () => {
    expect(SshPublicKey.parse(`${ED25519} laptop@home`).toAuthorizedKeysLine()).toBe(
      `restrict,command="internal-sftp" ${ED25519} laptop@home`,
    );
  });

  it('should_join_a_comment_of_several_words_with_single_spaces', () => {
    expect(SshPublicKey.parse(`${ED25519} my   work\tlaptop`).comment).toBe('my work laptop');
  });

  it('should_fingerprint_the_type_and_the_key_without_the_comment', () => {
    expect(SshPublicKey.parse(`${ED25519} laptop@home`).fingerprintSource).toBe(ED25519);
  });

  it.each(['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384'])(
    'should_accept_a_%s_key',
    (type) => {
      expect(SshPublicKey.parse(`${type} ${BODY}`).type).toBe(type);
    },
  );

  it('should_name_the_accepted_types_when_it_refuses_one', () => {
    expect(() => SshPublicKey.parse(`ssh-rsa ${BODY}`)).toThrow(
      'invalid ssh public key: unsupported type "ssh-rsa", expected one of ' +
        'ssh-ed25519, ecdsa-sha2-nistp256, ecdsa-sha2-nistp384',
    );
  });

  it('should_refuse_a_carriage_return_as_much_as_a_line_feed', () => {
    expect(() => SshPublicKey.parse(`${ED25519}\r${ED25519}`)).toThrow(
      'invalid ssh public key: it must be a single line',
    );
    expect(() => SshPublicKey.parse(`${ED25519}\n${ED25519}`)).toThrow(
      'invalid ssh public key: it must be a single line',
    );
  });

  it('should_tell_a_member_who_pasted_a_private_key_never_to_do_it', () => {
    expect(() => SshPublicKey.parse('-----BEGIN OPENSSH PRIVATE KEY-----')).toThrow(
      /that is a private key/,
    );
  });

  it('should_ask_for_a_key_when_only_a_type_is_given', () => {
    for (const raw of ['ssh-ed25519', '']) {
      expect(() => SshPublicKey.parse(raw), raw).toThrow(
        'invalid ssh public key: expected a type and a key',
      );
    }
  });

  it('should_accept_a_key_of_32_characters_and_refuse_one_of_31', () => {
    expect(SshPublicKey.parse(`ssh-ed25519 ${'A'.repeat(32)}`).body).toBe('A'.repeat(32));
    expect(() => SshPublicKey.parse(`ssh-ed25519 ${'A'.repeat(31)}`)).toThrow(NOT_BASE64);
  });

  it('should_accept_a_key_of_1024_characters_and_refuse_one_of_1025', () => {
    expect(SshPublicKey.parse(`ssh-ed25519 ${'A'.repeat(1024)}`).body).toHaveLength(1024);
    expect(() => SshPublicKey.parse(`ssh-ed25519 ${'A'.repeat(1025)}`)).toThrow(NOT_BASE64);
  });

  it('should_accept_every_base64_character_and_its_padding', () => {
    const body = `${'Az09+/'.repeat(6)}==`;

    expect(SshPublicKey.parse(`ssh-ed25519 ${body}`).body).toBe(body);
  });

  it('should_refuse_a_key_that_is_not_base64_anywhere_in_it', () => {
    // anchored at both ends: a valid start or end does not excuse the rest
    for (const body of [`!${BODY}`, `${BODY}!`, `${BODY}====`, `=${BODY}`]) {
      expect(() => SshPublicKey.parse(`ssh-ed25519 ${body}`), body).toThrow(NOT_BASE64);
    }
  });

  it('should_accept_a_comment_of_255_characters_and_refuse_one_of_256', () => {
    expect(SshPublicKey.parse(`${ED25519} ${'c'.repeat(255)}`).comment).toHaveLength(255);
    expect(() => SshPublicKey.parse(`${ED25519} ${'c'.repeat(256)}`)).toThrow(
      'invalid ssh public key: the comment contains a line break',
    );
  });
});
