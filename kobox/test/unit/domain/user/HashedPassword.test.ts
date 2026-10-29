import { describe, expect, it } from 'vitest';
import {
  HashedPassword,
  InvalidHashedPasswordError,
} from '../../../../src/domain/user/HashedPassword.js';

const SHA512_CRYPT = '$6$rounds=5000$abcdefgh$0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH';
const YESCRYPT = '$y$j9T$abcdefgh$0123456789abcdefghijklmnopqrstuvwxyz';

describe('HashedPassword', () => {
  it('should_accept_sha512_crypt_and_yescrypt_hashes', () => {
    expect(HashedPassword.parse(SHA512_CRYPT).value).toBe(SHA512_CRYPT);
    expect(HashedPassword.parse(YESCRYPT).value).toBe(YESCRYPT);
  });

  it('should_reject_plaintext_and_malformed_hashes', () => {
    for (const raw of ['', 's3cretpw', 'md5$x', '$1$weak$hash', '$6$', '$6$with space$x']) {
      expect(() => HashedPassword.parse(raw)).toThrow(InvalidHashedPasswordError);
    }
  });
});

describe('HashedPassword boundaries', () => {
  it('should_accept_a_hash_of_16_characters_and_refuse_one_of_15', () => {
    expect(HashedPassword.parse('$6$abcdefghijklm').value).toBe('$6$abcdefghijklm');
    expect(() => HashedPassword.parse('$6$abcdefghijkl')).toThrow(InvalidHashedPasswordError);
  });

  it('should_accept_every_character_a_crypt_hash_uses', () => {
    const raw = '$y$j9T$AZaz09./=,-$tail';

    expect(HashedPassword.parse(raw).value).toBe(raw);
  });

  it('should_refuse_a_weaker_scheme_with_a_plausible_body', () => {
    expect(() => HashedPassword.parse('$5$rounds=5000$abcdefghijkl')).toThrow(
      'invalid hashed password: expected a sha512-crypt ($6$) or yescrypt ($y$) hash',
    );
  });

  it('should_refuse_a_hash_wrapped_in_other_text', () => {
    // anchored at both ends: a valid hash inside a longer string is not a hash
    for (const raw of [`x${SHA512_CRYPT}`, `${SHA512_CRYPT} x`, `${SHA512_CRYPT}\n`]) {
      expect(() => HashedPassword.parse(raw), JSON.stringify(raw)).toThrow(
        InvalidHashedPasswordError,
      );
    }
  });

  it('should_never_print_the_hash_itself', () => {
    const hash = HashedPassword.parse(SHA512_CRYPT);

    expect(String(hash)).toBe('[password-hash]');
    expect(JSON.stringify({ hash })).toBe('{"hash":"[password-hash]"}');
  });
});
