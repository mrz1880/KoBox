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
