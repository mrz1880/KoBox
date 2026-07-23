import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../../src/domain/shared/DomainError.js';

class SampleInvariantError extends DomainError {
  constructor() {
    super('sample invariant violated');
  }
}

describe('DomainError', () => {
  it('should_expose_subclass_name_and_message', () => {
    const error = new SampleInvariantError();

    expect(error.name).toBe('SampleInvariantError');
    expect(error.message).toBe('sample invariant violated');
  });

  it('should_be_instanceof_error_and_domain_error', () => {
    const error = new SampleInvariantError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
  });
});
