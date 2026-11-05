import { describe, expect, it } from 'vitest';
import {
  HostKeyFingerprint,
  InvalidHostKeyFingerprintError,
} from '../../../../src/domain/sync/HostKeyFingerprint.js';

describe('HostKeyFingerprint', () => {
  it('should_take_the_sha256_digest_ssh_prints', () => {
    expect(HostKeyFingerprint.parse('SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s').value).toBe(
      'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
    );
  });

  // it lands on the member's page: anything but a digest is not one
  it('should_refuse_anything_that_is_not_a_sha256_digest', () => {
    expect(() => HostKeyFingerprint.parse('<script>')).toThrow(InvalidHostKeyFingerprintError);
  });

  it('should_tell_one_identity_from_another', () => {
    const one = HostKeyFingerprint.parse('SHA256:abc');

    expect(one.equals(HostKeyFingerprint.parse('SHA256:abc'))).toBe(true);
    expect(one.equals(HostKeyFingerprint.parse('SHA256:abd'))).toBe(false);
  });
});
